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
// Note: For production, ensure SUPABASE_KEY is your 'service_role' key 
// if you have Row Level Security (RLS) enabled on your database.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 2. SECURITY MIDDLEWARE (The Shield) ---

// A. Set Secure HTTP Headers (Hides server info, prevents clickjacking)
app.use(helmet());

// B. Data Sanitization (Prevents hackers from injecting bad code)
// Lightweight sanitizer: only sanitize `req.body` and `req.params` to avoid
// compatibility issues with newer Node/Express where `req.query` may be a getter.
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
  'http://localhost:5173', // Vite Localhost
  'http://localhost:3000', // React Localhost
  // TODO: Add your actual Vercel domain here after deployment
  // e.g., 'https://rex360-solutions.vercel.app' 
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

// E. Rate Limiting (Prevents DDoS/Spamming)
// Limit each IP to 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: "Too many requests from this IP, please try again after 15 minutes."
});
app.use(limiter);

// Limit body size to prevent crash attacks (10kb is enough for JSON data)
app.use(express.json({ limit: '10kb' })); 

// --- 3. CONFIGURE UPLOAD (Memory Storage) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- HELPER: UPLOAD TO SUPABASE (With Filename Cleaning) ---
async function uploadToSupabase(file) {
    // 1. CLEAN THE FILENAME (Crucial for Manual Uploads)
    // Converts "My Photo.jpg" -> "My_Photo.jpg" to prevent broken links
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${Date.now()}_${cleanName}`;
    
    // 2. Upload original
    const { data, error } = await supabase.storage
        .from('uploads') // Make sure your bucket is named 'uploads'
        .upload(fileName, file.buffer, { contentType: file.mimetype, cacheControl: 'public, max-age=31536000, immutable' });

    if (error) throw error;

    // 3. If image, create resized variants (320, 640, 1280) in JPEG + WebP and a tiny LQIP
    const variants = {};
    let lqip = null;
    if (file.mimetype.startsWith('image')) {
        const sizes = [320, 640, 1280];
        const baseName = cleanName.replace(/\.[^.]+$/, '');
        for (const size of sizes) {
            try {
                // JPEG variant
                const jpegBuf = await sharp(file.buffer)
                    .resize({ width: size })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                const variantNameJpg = `${Date.now()}_${size}_${baseName}.jpg`;
                const { error: errJ } = await supabase.storage.from('uploads').upload(variantNameJpg, jpegBuf, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' });
                let jpgUrl = null;
                if (!errJ) {
                    const { data: pubJ } = supabase.storage.from('uploads').getPublicUrl(variantNameJpg);
                    jpgUrl = pubJ.publicUrl;
                }

                // WebP variant
                const webpBuf = await sharp(file.buffer)
                    .resize({ width: size })
                    .webp({ quality: 75 })
                    .toBuffer();
                const variantNameWebp = `${Date.now()}_${size}_${baseName}.webp`;
                const { error: errW } = await supabase.storage.from('uploads').upload(variantNameWebp, webpBuf, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
                let webpUrl = null;
                if (!errW) {
                    const { data: pubW } = supabase.storage.from('uploads').getPublicUrl(variantNameWebp);
                    webpUrl = pubW.publicUrl;
                }

                variants[size] = { jpg: jpgUrl || null, webp: webpUrl || null };
            } catch (e) {
                console.warn('Variant generation failed for size', size, e.message);
            }
        }

        // Generate tiny blurred LQIP (20px wide)
        try {
            const tiny = await sharp(file.buffer).resize({ width: 20 }).jpeg({ quality: 50 }).blur(1).toBuffer();
            lqip = `data:image/jpeg;base64,${tiny.toString('base64')}`;
        } catch (e) {
            console.warn('LQIP generation failed', e.message);
        }
    }

    // 4. Get Public Link for original
    const { data: publicData } = supabase.storage.from('uploads').getPublicUrl(fileName);

    return { original: publicData.publicUrl, variants, lqip };
}

// --- ROUTES ---

// Get All Posts
app.get('/api/posts', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json(error);

    // Derive variants for posts that don't have them (backfill for older records)
    const deriveVariants = (post) => {
        if (!post || !post.media_url || post.media_type !== 'image') return post;
        if (post.media_variants) return post;
        try {
            const parts = post.media_url.split('/');
            const filename = parts.pop();
            const idx = filename.indexOf('_');
            if (idx === -1) { parts.push(filename); return post; }
            const ts = filename.slice(0, idx);
            const rest = filename.slice(idx + 1);
            const sizes = [320, 640, 1280];
            const variants = {};
            for (const size of sizes) {
                const jpg = [...parts, `${ts}_${size}_${rest}`].join('/');
                const webp = jpg.replace(/\.(jpg|jpeg)$/i, '.webp');
                variants[size] = { jpg, webp };
            }
            post.media_variants = variants;
            return post;
        } catch (e) { return post; }
    };

    res.json(data.map(deriveVariants));
});

// Get Single Post (For "Read Article")
app.get('/api/posts/:id', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ message: "Post not found" });
    // Derive variants if missing
    if (data && data.media_type === 'image' && !data.media_variants && data.media_url) {
        try {
            const parts = data.media_url.split('/');
            const filename = parts.pop();
            const idx = filename.indexOf('_');
            if (idx !== -1) {
                const ts = filename.slice(0, idx);
                const rest = filename.slice(idx + 1);
                const sizes = [320, 640, 1280];
                const variants = {};
                for (const size of sizes) {
                    const jpg = [...parts, `${ts}_${size}_${rest}`].join('/');
                    const webp = jpg.replace(/\.(jpg|jpeg)$/i, '.webp');
                    variants[size] = { jpg, webp };
                }
                data.media_variants = variants;
            }
        } catch (e) { /* ignore */ }
    }
    res.json(data);
});

// Create Post (Manual Upload Handler)
app.post('/api/posts', upload.single('media'), async (req, res) => {
    try {
        let uploadResult = null;
        if (req.file) {
            console.log("Uploading file:", req.file.originalname); // Debug log
            uploadResult = await uploadToSupabase(req.file);
        }

        const newPost = {
            title: req.body.title,
            excerpt: req.body.excerpt,
            category: req.body.category || "News",
            // Save as 'video' or 'image' based on file type
            media_type: req.file?.mimetype.startsWith('video') ? 'video' : 'image',
            media_url: uploadResult ? uploadResult.original : null
        };

        const { data, error } = await supabase.from('posts').insert([newPost]).select();
        
        if (error) {
            console.error("Database Error:", error);
            throw error;
        }

        // Attach variants in API response (doesn't require DB schema changes)
        const inserted = data[0];
        if (uploadResult && uploadResult.variants) inserted.media_variants = uploadResult.variants;
        res.json(inserted);

    } catch (err) {
        console.error("Upload Failed:", err.message);
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