require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

// FIX: Updated CORS to explicitly allow Authorization headers for DELETE requests
app.use(cors({
  origin: "*", 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- SECURITY MIDDLEWARE ---
const verifyAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: "No token provided" });

        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user || user.email !== 'rex360solutions@gmail.com') {
            return res.status(403).json({ error: "Unauthorized: Admin access required" });
        }

        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ error: "Invalid session" });
    }
};

async function uploadToSupabase(file) {
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${Date.now()}_${cleanName}`;
    const { error } = await supabase.storage.from('uploads').upload(fileName, file.buffer, { contentType: file.mimetype });
    if (error) throw error;
    const { data } = supabase.storage.from('uploads').getPublicUrl(fileName);
    return { original: data.publicUrl };
}

// --- ROUTES ---

app.get('/', (req, res) => res.json({ status: "Online", message: "REX360 Backend Secure" }));

// --- BLOG ROUTES ---
app.get('/api/posts', async (req, res) => {
    const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/posts', verifyAdmin, upload.single('media'), async (req, res) => {
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

app.delete('/api/posts/:id', verifyAdmin, async (req, res) => {
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

app.post('/api/slides', verifyAdmin, upload.single('image'), async (req, res) => {
    try {
        let imageUrl = null;
        if (req.file) {
            const result = await uploadToSupabase(req.file);
            imageUrl = result.original;
        }
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

// FIXED: Handles the DELETE request for slides
app.delete('/api/slides/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('slides').delete().eq('id', id);
        if (error) throw error;
        res.json({ message: "Slide removed successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SERVICES ROUTES ---
app.get('/api/services', async (req, res) => {
    const { data, error } = await supabase.from('services').select('*').order('id', { ascending: true });
    if (error) return res.json([]);
    res.json(data);
});

app.put('/api/services/:id', verifyAdmin, async (req, res) => {
    const { error } = await supabase.from('services').update(req.body).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Updated successfully" });
});

if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;