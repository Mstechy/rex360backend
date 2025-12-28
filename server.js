// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// --- 1. SETUP ---
const app = express();
const PORT = process.env.PORT || 5000;

// Universal CORS (Allows your Phone & Laptop)
app.use(cors());
app.use(express.json());

// Connect to Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Setup Upload (Memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- 2. SIMPLE UPLOAD (No Sharp) ---
async function uploadToSupabase(file) {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${Date.now()}_${cleanName}`;
    
    // Upload file directly
    const { error } = await supabase.storage
        .from('uploads')
        .upload(fileName, file.buffer, { contentType: file.mimetype });

    if (error) throw error;

    // Get Link
    const { data } = supabase.storage.from('uploads').getPublicUrl(fileName);
    return { original: data.publicUrl };
}

// --- 3. ROUTES ---

// >>> THE WELCOME ROUTE (Test this first!) <<<
app.get('/', (req, res) => {
    res.send("<h1>✅ REX360 Backend is ONLINE!</h1><p>Go to <a href='/api/posts'>/api/posts</a> to see data.</p>");
});

// Get Posts
app.get('/api/posts', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Create Post
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

// --- 4. START SERVER (Required for Vercel) ---
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;