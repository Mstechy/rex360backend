require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

async function uploadToSupabase(file) {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${Date.now()}_${cleanName}`;
    const { error } = await supabase.storage.from('uploads').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (error) throw error;
    const { data } = supabase.storage.from('uploads').getPublicUrl(fileName);
    return { original: data.publicUrl };
}

// --- ROUTES ---

// 1. Health Check
app.get('/', (req, res) => res.json({ status: "Online", message: "REX360 Backend is running!" }));

// --- BLOG ROUTES ---
// Get ALL Posts
app.get('/api/posts', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ✅ THIS IS THE MISSING PIECE (Fixes the 404 Error)
app.get('/api/posts/:id', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: "Post not found" });
    res.json(data);
});

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

app.delete('/api/posts/:id', async (req, res) => {
    const { error } = await supabase.from('posts').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Deleted successfully" });
});

// --- SLIDER ROUTES ---
app.get('/api/slides', async (req, res) => {
    const { data, error } = await supabase.from('slides').select('*').order('created_at', { ascending: true });
    if (error) return res.json([]);
    res.json(data);
});

app.post('/api/slides', upload.single('image'), async (req, res) => {
    try {
        let imageUrl = null;
        if (req.file) {
            const result = await uploadToSupabase(req.file);
            imageUrl = result.original;
        }
        // Force 'hero' section so it appears on the Home Page slider
        const newSlide = {
            section: req.body.section || 'hero', 
            type: 'image',
            image_url: imageUrl
        };
        const { data, error } = await supabase.from('slides').insert([newSlide]).select();
        if (error) throw error;
        res.json(data[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/slides/:id', async (req, res) => {
    const { error } = await supabase.from('slides').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Deleted successfully" });
});

// --- SERVICES ROUTES (For Manage Prices) ---
app.get('/api/services', async (req, res) => {
    const { data, error } = await supabase.from('services').select('*').order('id', { ascending: true });
    if (error) return res.json([]);
    res.json(data);
});

app.put('/api/services/:id', async (req, res) => {
    const { error } = await supabase.from('services').update(req.body).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Updated successfully" });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;