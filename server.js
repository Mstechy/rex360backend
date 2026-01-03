require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

// --- PRO-MEASURE: DYNAMIC CORS ARCHITECTURE ---
// This list covers every possible way a user hits your site
const allowedOrigins = [
  'https://rex360solutions.com',
  'https://www.rex360solutions.com',
  'https://rex360-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      console.error(`[CORS REJECTED]: ${origin}`);
      callback(new Error('CORS Policy Violation'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true
}));

// Handle Preflight OPTIONS requests globally
app.options('*', cors());

app.use(express.json());

// --- INFRASTRUCTURE CLIENTS ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } 
});

// --- ELITE EMAIL AUTOMATION ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rex360solutions@gmail.com',
        pass: process.env.GMAIL_APP_PASSWORD 
    }
});

// --- AUTHENTICATION SHIELD ---
const verifyAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "Access Denied: No Token" });
        
        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user || user.email !== 'rex360solutions@gmail.com') {
            return res.status(403).json({ error: "Unauthorized: Admin Required" });
        }
        req.user = user;
        next();
    } catch (err) { res.status(401).json({ error: "Session Expired" }); }
};

// --- TRANSACTIONAL FLOW (PAYSTACK) ---

app.post('/api/payments/initialize', async (req, res) => {
    try {
        const { email, amount, serviceName } = req.body;
        const cleanAmount = String(amount).replace(/[^0-9]/g, '');
        const amountInKobo = parseInt(cleanAmount) * 100;

        const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize', {
            email,
            amount: amountInKobo,
            callback_url: "https://rex360solutions.com/payment-success",
            metadata: { service_name: serviceName }
        }, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        
        res.json(paystackRes.data.data);
    } catch (err) { 
        console.error("[MONITOR]: Paystack Init Error", err.response?.data || err.message);
        res.status(500).json({ error: "Financial Handshake Failed" }); 
    }
});

app.post('/api/payments/webhook', async (req, res) => {
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                       .update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401);

    const event = req.body;
    if (event.event === 'charge.success') {
        const email = event.data.customer.email;
        const service = event.data.metadata.service_name;
        const ref = event.data.reference;

        const mailOptions = {
            from: '"REX360 COMPLIANCE" <rex360solutions@gmail.com>',
            to: email,
            subject: `Action Required: Formalize ${service}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: #10b981;">Payment Verified</h2>
                <p>Order Reference: <b>${ref}</b></p>
                <p>We have successfully received payment for <b>${service}</b> registration.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p>To begin the filing process, please submit your business details via our secure onboarding portal:</p>
                <a href="https://rex360solutions.com/onboarding" style="background: #000; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 10px; display: inline-block; font-weight: bold;">Submit Business Details</a>
                <p style="font-size: 12px; color: #999; margin-top: 30px;">REX360 SOLUTIONS LTD • Accredited CAC Agent</p>
              </div>
            `
        };
        await transporter.sendMail(mailOptions);
    }
    res.sendStatus(200);
});

// --- CONTENT ORCHESTRATION ---

async function uploadToSupabase(file) {
    const fileExt = file.originalname.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('uploads').upload(fileName, file.buffer, { 
        contentType: file.mimetype,
        cacheControl: '3600'
    });
    if (error) throw error;
    return supabase.storage.from('uploads').getPublicUrl(fileName).data.publicUrl;
}

app.get('/api/slides', async (req, res) => {
    const { data, error } = await supabase.from('slides').select('*').order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.get('/api/posts', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.get('/api/posts/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('posts').select('*').eq('id', req.params.id).single();
        if (error || !data) return res.status(404).json({ error: "Resource Not Found" });
        res.json(data);
    } catch (err) { res.status(500).json({ error: "Query Collision" }); }
});

app.get('/api/services', async (req, res) => {
    const { data, error } = await supabase.from('services').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

app.post('/api/posts', verifyAdmin, upload.single('media'), async (req, res) => {
    try {
        const url = req.file ? await uploadToSupabase(req.file) : null;
        const postData = { ...req.body, media_url: url, media_type: req.file?.mimetype.startsWith('video') ? 'video' : 'image' };
        const { data, error } = await supabase.from('posts').insert([postData]).select();
        if (error) throw error;
        res.status(201).json(data[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/services/:id', verifyAdmin, async (req, res) => {
    const { error } = await supabase.from('services').update(req.body).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Financial Node Updated" });
});

app.get('/', (req, res) => res.json({ status: "Architect Engine Online" }));

app.use((req, res) => res.status(404).json({ error: "API Route Unavailable" }));

app.listen(PORT, () => console.log(`[MONITOR]: System running on Port ${PORT}`));
module.exports = app;