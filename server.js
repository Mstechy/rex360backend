require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- PRO-MEASURE: DYNAMIC CORS ARCHITECTURE ---
const allowedOrigins = [
  'https://rex360solutions.com',
  'https://www.rex360solutions.com',
  'https://rex360-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Violation'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: true
}));

// Handle Preflight OPTIONS for Vercel
app.options('*', cors());

app.use(express.json());

// --- INFRASTRUCTURE CLIENTS ---
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

const verifyAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "No Token" });
        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user || user.email !== 'rex360solutions@gmail.com') {
            return res.status(403).json({ error: "Unauthorized" });
        }
        req.user = user;
        next();
    } catch (err) { res.status(401).json({ error: "Expired" }); }
};

// --- ROUTES ---
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
    } catch (err) { res.status(500).json({ error: "Payment Failed" }); }
});

app.post('/api/payments/webhook', async (req, res) => {
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');
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
            html: `<div style="font-family: sans-serif; padding: 20px;"><h2>Verified</h2><p>Ref: ${ref}</p><p>Paid for <b>${service}</b>.</p><a href="https://rex360solutions.com/onboarding">Submit Details</a></div>`
        };
        await transporter.sendMail(mailOptions);
    }
    res.sendStatus(200);
});

app.get('/api/slides', async (req, res) => {
    const { data } = await supabase.from('slides').select('*').order('created_at', { ascending: true });
    res.json(data || []);
});

app.get('/api/posts', async (req, res) => {
    const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});

app.get('/api/posts/:id', async (req, res) => {
    const { data } = await supabase.from('posts').select('*').eq('id', req.params.id).single();
    res.json(data);
});

app.get('/api/services', async (req, res) => {
    const { data } = await supabase.from('services').select('*').order('id', { ascending: true });
    res.json(data || []);
});

app.post('/api/posts', verifyAdmin, upload.single('media'), async (req, res) => {
    try {
        const file = req.file;
        const fileName = `${Date.now()}.${file.originalname.split('.').pop()}`;
        await supabase.storage.from('uploads').upload(fileName, file.buffer, { contentType: file.mimetype });
        const url = supabase.storage.from('uploads').getPublicUrl(fileName).data.publicUrl;
        const postData = { ...req.body, media_url: url, media_type: file.mimetype.startsWith('video') ? 'video' : 'image' };
        const { data } = await supabase.from('posts').insert([postData]).select();
        res.status(201).json(data[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/services/:id', verifyAdmin, async (req, res) => {
    await supabase.from('services').update(req.body).eq('id', req.params.id);
    res.json({ message: "Updated" });
});

app.get('/', (req, res) => res.json({ status: "Architect Engine Online" }));

// --- VERCEL EXPORT ---
// CRITICAL: Vercel needs the app exported to handle it as a serverless function
module.exports = app;