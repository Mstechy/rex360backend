require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- 1. GATEKEEPER: ARCHITECTURAL CORS ---
const allowedOrigins = [
  'https://rex360solutions.com',        // Your new domain
  'https://www.rex360solutions.com',    // The 'www' version
  'https://rex360-frontend.vercel.app', // Your Vercel preview link
  'http://localhost:5173'               // Your local development machine
];

app.use(cors({
  origin: function (origin, callback) {
    // If the origin is in our list, or if it's a local request (no origin), let it through
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// --- 2. INFRASTRUCTURE SETUP ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // Expanded to 15MB for Video support
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rex360solutions@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD 
    }
});

// --- 3. SECURITY & AUDIT MIDDLEWARE ---
const verifyAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Access Denied" });
        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user || user.email !== 'rex360solutions@gmail.com') {
            return res.status(403).json({ error: "Unauthorized Node Access" });
        }
        req.user = user;
        next();
    } catch (err) { res.status(401).json({ error: "Session Expired" }); }
};

const logAction = async (email, action, details) => {
    try {
        await supabase.from('audit_logs').insert([{
            admin_email: email,
            action_type: action,
            details: details
        }]);
    } catch (err) { console.error("Audit node failure", err); }
};

// --- 4. ASSET MANAGEMENT (KINETIC SLIDES & MEDIA) ---

app.post('/api/admin/upload', verifyAdmin, upload.single('media'), async (req, res) => {
    try {
        const file = req.file;
        const fileName = `agency/${Date.now()}-${file.originalname}`;
        
        const { data, error } = await supabase.storage
            .from('assets') 
            .upload(fileName, file.buffer, { contentType: file.mimetype, cacheControl: '3600' });

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
            .from('assets')
            .getPublicUrl(fileName);

        res.json({ url: publicUrl, type: file.mimetype.startsWith('video') ? 'video' : 'image' });
    } catch (err) { res.status(500).json({ error: "Cloud Media Sync Failed" }); }
});

// GET: Kinetic Slides for Home Flow
app.get('/api/slides', async (req, res) => {
    const { data } = await supabase.from('slides').select('*').order('created_at', { ascending: true });
    res.json(data || []);
});

// POST: Add new cinematic slide with text parts
app.post('/api/slides', verifyAdmin, async (req, res) => {
    const { title_part_1, title_part_2, subtitle, media_url, media_type, label } = req.body;
    const { data, error } = await supabase.from('slides').insert([{ 
        title_part_1, title_part_2, subtitle, media_url, media_type, label 
    }]).select();
    
    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'SLIDE_ADD', `Added kinetic slide: ${title_part_1}`);
    res.json(data[0]);
});

// AGENT IDENTITY: For the morphing "About" blob
app.get('/api/agent-profile', async (req, res) => {
    const { data } = await supabase.from('agent_profile').select('*').single();
    res.json(data || {});
});

app.put('/api/agent-profile', verifyAdmin, async (req, res) => {
    const { profile_url, bio } = req.body;
    const { data, error } = await supabase.from('agent_profile').upsert({ id: 1, profile_url, bio }).select();
    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'PROFILE_SYNC', 'Updated agency identity photo');
    res.json(data[0]);
});

// --- 5. REGISTRY & MATURE SERVICE SYNC ---

// GET: 7 Separate Service Nodes
app.get('/api/services', async (req, res) => {
    const { data } = await supabase.from('services').select('*').order('id', { ascending: true });
    res.json(data || []);
});

app.get('/api/applications', verifyAdmin, async (req, res) => {
    const { data } = await supabase.from('applications').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});

// Update Workflow Status & Trigger Email Node
app.put('/api/applications/:id/status', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { status, email, businessName } = req.body;

    const { data, error } = await supabase.from('applications').update({ status }).eq('id', id).select();
    
    if (status === 'completed' && !error) {
        await transporter.sendMail({
            from: '"REX360 SOLUTIONS" <rex360solutions@gmail.com>',
            to: email,
            subject: `✅ Registration Certified: ${businessName}`,
            html: `<div style="font-family:sans-serif; padding:20px; border:1px solid #eee;">
                    <h2 style="color:#10b981;">Certification Complete</h2>
                    <p>Your entity <b>${businessName}</b> has been successfully registered.</p>
                    <p>Login to your portal to download certificates.</p>
                   </div>`
        });
    }

    await logAction(req.user.email, 'STATUS_UPDATE', `${businessName} moved to ${status}`);
    res.json({ success: true, data: data[0] });
});

// --- 6. FINANCIALS (PAYSTACK & AUDIT) ---

app.put('/api/services/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { price, description } = req.body;
    const { data, error } = await supabase.from('services').update({ price, description }).eq('id', id).select();
    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'FINANCIAL_MOD', `Service ${id} updated to ₦${price}`);
    res.json(data[0]);
});

app.post('/api/payments/initialize', async (req, res) => {
    try {
        const { email, amount, serviceName, metadata } = req.body;
        const amountInKobo = parseInt(String(amount).replace(/\D/g, '')) * 100;
        
        const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize', {
            email, amount: amountInKobo,
            callback_url: "https://rex360solutions.com/payment-success",
            metadata: { ...metadata, service_name: serviceName }
        }, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        res.json(paystackRes.data.data);
    } catch (err) { res.status(500).json({ error: "Payment node offline" }); }
});

app.get('/api/logs', verifyAdmin, async (req, res) => {
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});

// --- VERCEL EXPORT ---
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(5000, () => console.log('REX360 Engine operational on port 5000'));
}