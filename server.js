require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// --- SECURITY PACKAGES ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 5000;

// --- 1. CONNECT TO SUPABASE ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 2. SECURITY MIDDLEWARE (The Shield) ---

// A. Set Secure HTTP Headers
app.use(helmet());

// B. Data Sanitization
function sanitizeInputs(req, res, next) {
    const purify = (val) => typeof val === 'string'
        ? val.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        : val;
    const sanitize = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
            if (obj[key] && typeof obj[key] === 'object') sanitize(obj[key]);
            else obj[key] = purify(obj[key]);
        }
    };
    sanitize(req.body);
    sanitize(req.params);
    next();
}
app.use(sanitizeInputs);

// C. Prevent Parameter Pollution
app.use(hpp());

// D. Strict CORS (Only allow YOUR website to talk to this server)
const allowedOrigins = [
  'http://localhost:5173',                 // Localhost
  'https://rex360-frontend.vercel.app'     // YOUR LIVE WEBSITE
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

// E. Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: "Too many requests from this IP, please try again after 15 minutes."
});
app.use(limiter);

// Limit body size
app.use(express.json({ limit: '10kb' })); 

// --- 3. CONFIGURE UPLOAD (Memory Storage) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- HELPER: UPLOAD TO SUPABASE ---
async function uploadToSupabase(file) {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${Date.now()}_${cleanName}`;
    
    const { data, error } = await supabase.storage
        .from('uploads')
        .upload(fileName, file.buffer, { contentType: file.mimetype, cacheControl: 'public, max-age=31536000, immutable' });

    if (error) throw error;

    const variants = {};
    let lqip = null;
    if (file.mimetype.startsWith('image')) {
        const sizes = [320, 640, 1280];
        const baseName = cleanName.replace(/\.[^.]+$/, '');
        for (const size of sizes) {
            try {
                // JPEG
                const jpegBuf = await sharp(file.buffer).resize({ width: size }).jpeg({ quality: 80 }).toBuffer();
                const variantNameJpg = `${Date.now()}_${size}_${baseName}.jpg`;
                await supabase.storage.from('uploads').upload(variantNameJpg, jpegBuf, { contentType: 'image/jpeg' });
                const { data: pubJ } = supabase.storage.from('uploads').getPublicUrl(variantNameJpg);
                
                // WebP
                const webpBuf = await sharp(file.buffer).resize({ width: size }).webp({ quality: 75 }).toBuffer();
                const variantNameWebp = `${Date.now()}_${size}_${baseName}.webp`;
                await supabase.storage.from('uploads').upload(variantNameWebp, webpBuf, { contentType: 'image/webp' });
                const { data: pubW } = supabase.storage.from('uploads').getPublicUrl(variantNameWebp);

                variants[size] = { jpg: pubJ.publicUrl, webp: pubW.publicUrl };
            } catch (e) {
                console.warn('Variant generation failed', e.message);
            }
        }
        // LQIP
        try {
            const tiny = await sharp(file.buffer).resize({ width: 20 }).jpeg({ quality: 50 }).blur(1).toBuffer();
            lqip = `data:image/jpeg;base64,${tiny.toString('base64')}`;
        } catch (e) {}
    }

    const { data: publicData } = supabase.storage.from('uploads').getPublicUrl(fileName);
    return { original: publicData.publicUrl, variants, lqip };
}

// --- ROUTES ---

// Get All Posts
app.get('/api/posts', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json(error);
    res.json(data);
});

// Get Single Post
app.get('/api/posts/:id', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ message: "Post not found" });
    res.json(data);
});

// Create Post
app.post('/api/posts', upload.single('media'), async (req, res) => {
    try {
        let uploadResult = null;
        if (req.file) uploadResult = await uploadToSupabase(req.file);

        const newPost = {
            title: req.body.title,
            excerpt: req.body.excerpt,
            category: req.body.category || "News",
            media_type: req.file?.mimetype.startsWith('video') ? 'video' : 'image',
            media_url: uploadResult ? uploadResult.original : null,
            media_variants: uploadResult ? uploadResult.variants : null,
            media_lqip: uploadResult ? uploadResult.lqip : null
        };

        const { data, error } = await supabase.from('posts').insert([newPost]).select();
        if (error) throw error;
        res.json(data[0]);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Post
app.delete('/api/posts/:id', async (req, res) => {
    await supabase.from('posts').delete().eq('id', req.params.id);
    res.json({ success: true });
});

// Other Routes
app.get('/api/services', async (req, res) => {
    const { data } = await supabase.from('services').select('*').order('id');
    res.json(data);
});
app.get('/api/transactions', async (req, res) => {
    const { data } = await supabase.from('transactions').select('*');
    res.json(data);
});
app.get('/api/slides', async (req, res) => {
    const { data } = await supabase.from('content').select('*');
    res.json(data);
});

app.listen(PORT, () => console.log(`🔒 Secure Server running on Port ${PORT}`));