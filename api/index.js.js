const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// 1. DYNAMIC CORS: Securely links your Frontend and Backend
app.use(cors({
  origin: ["https://rex360solutions.com", "http://localhost:5173"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));

app.use(express.json());

// 2. SUPABASE & MULTER: Optimized for Serverless (Memory Storage)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// --- MASTER ROUTES ---

// HEALTH CHECK: Verify the 404 is gone by visiting /api/health
app.get('/api/health', (req, res) => res.json({ status: "BUREAU ONLINE", time: new Date() }));

// UNIFIED UPLOAD: Hero Banners, Agent Identity, and News
app.post('/api/admin/upload', upload.single('media'), async (req, res) => {
  try {
    const file = req.file;
    const { section } = req.body;
    if (!file) return res.status(400).json({ error: "No media detected" });

    const fileName = `${section}/${Date.now()}-${file.originalname}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('rex-assets')
      .upload(fileName, file.buffer, { contentType: file.mimetype });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('rex-assets').getPublicUrl(fileName);

    // Sync to correct database node
    if (section === 'agent') {
      await supabase.from('agent_profile').upsert({ profile_url: publicUrl, id: 'admin-id' });
    } else {
      await supabase.from('slides').insert([{ media_url: publicUrl, section }]);
    }

    res.status(200).json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SERVICE UPDATE: Edit Title, Price, and Descriptions
app.put('/api/services/:id', async (req, res) => {
  const { id } = req.params;
  const { title, price, description } = req.body;
  const { data, error } = await supabase.from('services')
    .update({ title, price, description })
    .eq('id', id);
    
  if (error) return res.status(400).json(error);
  res.status(200).json({ message: "Node Synchronized", data });
});

// --- ASSET MANAGEMENT ---
app.get('/api/slides', async (req, res) => {
  const { data } = await supabase.from('slides').select('*');
  res.json(data);
});

app.delete('/api/slides/:id', async (req, res) => {
  await supabase.from('slides').delete().eq('id', req.params.id);
  res.json({ message: "Asset Purged" });
});

// CRITICAL: Export for Vercel Serverless Function
module.exports = app;