require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- DYNAMIC CORS ARCHITECTURE ---
const allowedOrigins = [
  'https://rex360solutions.com',
  'https://www.rex360solutions.com',
  'https://rex360-frontend.vercel.app',
  'http://localhost:5173'
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

// Mandatory Pre-flight handler for cross-domain browser requests
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

// --- AUTHENTICATION SHIELD ---
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

// --- CORE ROUTES ---

app.get('/api/posts', async (req, res) => {
    try {
        const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: "Query Failed" }); }
});

app.post('/api/payments/initialize', async (req, res) => {
    try {
        const { email, amount, serviceName } = req.body;
        const amountInKobo = parseInt(String(amount).replace(/\D/g, '')) * 100;

        const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize', {
            email,
            amount: amountInKobo,
            callback_url: "https://rex360solutions.com/payment-success",
            metadata: { service_name: serviceName }
        }, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        res.json(paystackRes.data.data);
    } catch (err) { res.status(500).json({ error: "Payment Link Generation Failed" }); }
});

app.get('/api/health', (req, res) => res.json({ status: "Vercel Architect Engine Online" }));

// --- THE VERCEL EXPORT (CRITICAL) ---
// Vercel does not use app.listen in production; it wraps this export.
module.exports = app;

// Local development listener
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`[LOCAL]: Node running on ${PORT}`));
}