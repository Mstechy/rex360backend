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
  'http://localhost:5173', // Local development
  'https://rex360frontend.vercel.app', // Your actual Vercel Frontend URL
  'https://rex360-solutions.vercel.app', // Frontend deployment URL
  'https://rex360-solutions-1.vercel.app', // Alternative deployment URL
  'https://rex360-solutions-2.vercel.app', // Another alternative
  /\.vercel\.app$/, // This allows ANY vercel sub-domain (Recommended)
  'https://rex360backend.vercel.app' // Allow backend to backend calls
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some((allowed) => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Handle OPTIONS preflight requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// --- 2. INFRASTRUCTURE SETUP ---
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
  : null;

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

// --- 4. CREDENTIALS & ACCREDITATIONS ---

// Verification Vault: Placeholders for your official certificates
app.get('/api/credentials', (req, res) => {
  res.json([
    { id: 1, title: 'CAC ACCREDITATION', code: 'RC-142280', icon: 'Award' },
    { id: 2, title: 'NEPC EXPORTER', code: 'NP-55092', icon: 'Globe' }
  ]);
});

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
    if (!supabase) return res.json([]);
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

// DELETE: Remove slide
app.delete('/api/slides/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('slides').delete().eq('id', id);
    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'SLIDE_DELETE', `Removed slide ${id}`);
    res.json({ success: true });
});

// AGENT IDENTITY: For the morphing "About" blob
app.get('/api/agent-profile', async (req, res) => {
    if (!supabase) return res.json({});
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
    if (!supabase) return res.json([]);
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

// Express Pacing Toggle for Tracking
app.put('/api/applications/:id/express', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { isExpress } = req.body;

  const { data, error } = await supabase
    .from('applications')
    .update({ is_express: isExpress })
    .eq('id', id);

  if (error) return res.status(400).json(error);
  await logAction(req.user.email, 'EXPRESS_TOGGLE', `Express mode ${isExpress ? 'enabled' : 'disabled'} for application ${id}`);
  res.json({ message: "Speed protocol updated", data });
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

// --- 7. NEWS MANAGEMENT ---

// Intelligence Hub: Official News Briefings
app.get('/api/posts', async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

// GET: Single news post by ID
app.get('/api/posts/:id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Database unavailable" });
  const { id } = req.params;
  const { data, error } = await supabase.from('posts').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: "Post not found" });
  res.json(data);
});

// POST: Create new news post
app.post('/api/posts', verifyAdmin, async (req, res) => {
    const { title, content, category, media_url, media_type } = req.body;
    const { data, error } = await supabase.from('posts').insert([{
        title, content, category, media_url, media_type
    }]).select();

    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'POST_ADD', `Published news: ${title}`);
    res.json(data[0]);
});

// PUT: Update news post
app.put('/api/posts/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, content, category, media_url, media_type } = req.body;
    const { data, error } = await supabase.from('posts').update({
        title, content, category, media_url, media_type
    }).eq('id', id).select();

    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'POST_UPDATE', `Updated post: ${title}`);
    res.json(data[0]);
});

// DELETE: Remove news post
app.delete('/api/posts/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('posts').delete().eq('id', id);
    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'POST_DELETE', `Removed post ${id}`);
    res.json({ success: true });
});

// --- 8. CONTENT MANAGEMENT ---

// GET: Content assets
app.get('/api/content', verifyAdmin, async (req, res) => {
    const { data } = await supabase.from('content_assets').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});

// POST: Upload content asset
app.post('/api/content', verifyAdmin, async (req, res) => {
    const { name, type, url, category } = req.body;
    const { data, error } = await supabase.from('content_assets').insert([{
        name, type, url, category
    }]).select();

    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'CONTENT_ADD', `Added ${type} asset: ${name}`);
    res.json(data[0]);
});

// DELETE: Remove content asset
app.delete('/api/content/:id', verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('content_assets').delete().eq('id', id);
    if (error) return res.status(500).json(error);
    await logAction(req.user.email, 'CONTENT_DELETE', `Removed asset ${id}`);
    res.json({ success: true });
});

// --- VERCEL EXPORT ---
module.exports = app;

// --- LOCAL DEVELOPMENT SERVER ---
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
