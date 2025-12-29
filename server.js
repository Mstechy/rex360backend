require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

// --- 1. MIDDLEWARE (The Security Guard) ---
// This allows your frontend (Vercel) to talk to this backend
app.use(cors());
app.use(express.json());

// --- 2. SUPABASE CONNECTION ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Setup Memory Storage for Uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper: Upload to Supabase
async function uploadToSupabase(file) {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${Date.now()}_${cleanName}`;
    
    const { error } = await supabase.storage
        .from('uploads')
        .upload(fileName, file.buffer, { contentType: file.mimetype });

    if (error) throw error;

    const { data } = supabase.storage.from('uploads').getPublicUrl(fileName);
    return { original: data.publicUrl };
}

// --- 3. ROUTES ---

// ✅ Root Route (Health Check)
app.get('/', (req, res) => {
    res.json({ status: "Online", message: "REX360 Backend is running!" });
});

// ✅ GET Slides (THIS WAS MISSING BEFORE!)
app.get('/api/slides', async (req, res) => {
    try {
        // Try to get slides. If the table is empty or missing, return an empty list []
        const { data, error } = await supabase.from('slides').select('*');
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Slides Error:", err.message);
        res.json([]); // Return empty list to keep the site alive
    }
});

// ✅ GET Posts
app.get('/api/posts', async (req, res) => {
    try {
        const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ CREATE Post
app.post('/api/posts', upload.single('media'), async (req, res) => {
    try {
        let mediaUrl = null;
        if (req.file) {
            const result = await uploadToSupabase(req.file);
            mediaUrl = result.original;
        }

        const newPost = {
            title: req.body.title,
            excerpt: req.body.excerpt,
            category: req.body.category || "News",
            media_type: req.file?.mimetype.startsWith('video') ? 'video' : 'image',
            media_url: mediaUrl
        };

        const { data, error } = await supabase.from('posts').insert([newPost]).select();
        if (error) throw error;
        res.json(data[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 4. START SERVER ---
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;