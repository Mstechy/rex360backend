require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- 1. ARCHITECTURAL CORS (GATEKEEPER) ---
const allowedOrigins = [
  'https://rex360solutions.com',
  'https://www.rex360solutions.com',
  'https://rex360-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Violation: Origin Unauthorized'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true
}));

app.options('*', cors());
app.use(express.json());

// --- 2. INFRASTRUCTURE SETUP ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } 
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rex360solutions@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD 
    }
});

// --- 3. SECURITY & LOGGING MIDDLEWARE ---
const logAction = async (email, action, details) => {
    try {
        await supabase.from('audit_logs').insert([{
            admin_email: email,
            action_type: action,
            details: details
        }]);
    } catch (err) { console.error("[AUDIT ERROR]:", err); }
};

const verifyAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Access Denied" });
        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user || user.email !== 'rex360solutions@gmail.com') {
            return res.status(403).json({ error: "Unauthorized" });
        }
        req.user = user;
        next();
    } catch (err) { res.status(401).json({ error: "Session Expired" }); }
};

// --- 4. DATA ROUTES ---

app.get('/api/posts', async (req, res) => {
    try {
        const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: "Post Fetch Failed" }); }
});

app.get('/api/services', async (req, res) => {
    try {
        const { data, error } = await supabase.from('services').select('*').order('id', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: "Service Fetch Failed" }); }
});

// Update Service Pricing (Admin Only)
app.put('/api/services/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { price, original_price } = req.body;
        const { data, error } = await supabase.from('services').update({ price, original_price }).eq('id', id).select();
        if (error) throw error;
        await logAction(req.user.email, 'PRICE_UPDATE', `Service ${id} updated to ₦${price}`);
        res.json(data[0]);
    } catch (err) { res.status(500).json({ error: "Update Failed" }); }
});

// --- 5. FILING & STATUS ENGINE ---

// Get all applications (Admin Only)
app.get('/api/applications', verifyAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: "Registry Query Failed" }); }
});

// Insert new application (Client Post-Payment)
app.post('/api/applications', async (req, res) => {
    try {
        const formData = req.body;
        const { data, error } = await supabase.from('applications').insert([formData]).select();
        if (error) throw error;

        await transporter.sendMail({
            from: '"REX360 ENGINE" <rex360solutions@gmail.com>',
            to: 'rex360solutions@gmail.com',
            subject: '🚨 NEW FILING: ' + (formData.business_name_1 || 'New Business'),
            html: `<h3>New Application Received</h3><p>Director: ${formData.director_name || 'N/A'}</p>`
        });
        res.status(201).json({ success: true, data: data[0] });
    } catch (err) { res.status(500).json({ error: "Filing Node Failure" }); }
});

// Update Application Status & Notify Client
app.put('/api/applications/:id/status', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, email, businessName } = req.body;

        const { data, error } = await supabase.from('applications').update({ status }).eq('id', id).select();
        if (error) throw error;

        if (status === 'completed') {
            await transporter.sendMail({
                from: '"REX360 SOLUTIONS" <rex360solutions@gmail.com>',
                to: email,
                subject: `✅ Registration Complete: ${businessName}`,
                html: `<div style="font-family:sans-serif;"><h2>Filing Successful!</h2><p>Your business <b>${businessName}</b> is now registered with the CAC.</p></div>`
            });
        }
        await logAction(req.user.email, 'STATUS_CHANGE', `${businessName} set to ${status}`);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Status Update Failed" }); }
});

// --- 6. PAYMENTS (PAYSTACK) ---

app.post('/api/payments/initialize', async (req, res) => {
    try {
        const { email, amount, serviceName } = req.body;
        const amountInKobo = parseInt(String(amount).replace(/\D/g, '')) * 100;
        const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize', {
            email, amount: amountInKobo,
            callback_url: "https://rex360solutions.com/payment-success",
            metadata: { service_name: serviceName }
        }, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        res.json(paystackRes.data.data);
    } catch (err) { res.status(500).json({ error: "Payment Node Offline" }); }
});

// --- 7. ADMIN ASSETS ---
app.post('/api/admin/upload', verifyAdmin, upload.single('media'), async (req, res) => {
    try {
        const file = req.file;
        const fileName = `assets/${Date.now()}-${file.originalname}`;
        const { error } = await supabase.storage.from('assets').upload(fileName, file.buffer, { contentType: file.mimetype });
        if (error) throw error;
        const url = supabase.storage.from('assets').getPublicUrl(fileName).data.publicUrl;
        res.json({ url });
    } catch (err) { res.status(500).json({ error: "Upload Failed" }); }
});

// --- 8. SYSTEM HEALTH ---
app.get('/api/health', (req, res) => res.json({ status: "Vercel Architect Online", timestamp: new Date() }));
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(5000, () => console.log(`[TERMINATOR]: Engine Online at 5000`));
}
// TRACKING ENGINE: Find application by Email or Payment Reference
app.get('/api/track', async (req, res) => {
    try {
        const { query } = req.query;
        const { data, error } = await supabase
            .from('applications')
            .select('*')
            // This searches both the email and payment_ref columns
            .or(`email.eq.${query},payment_ref.eq.${query}`)
            .single();

        if (error || !data) return res.status(404).json({ error: "No filing found" });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: "Registry Sync Error" });
    }
});