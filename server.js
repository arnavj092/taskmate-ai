require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const allowedMimeTypes = new Set(['application/pdf', 'image/png', 'image/jpeg']);

app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    callback(null, allowedMimeTypes.has(file.mimetype));
  },
});

const prompt = `Analyze this project brief. Break it into a team project plan.
Return ONLY valid JSON with:
{
  "project_summary": "brief description",
  "tasks": [{"name": "...", "estimated_hours": 2, "priority": "high|medium|low"}],
  "team_roles": [{"role": "...", "tasks": ["task1", "task2"]}],
  "timeline": {"week1": ["Task A", "Task B"], "week2": ["Task C"]}
}
Be practical, specific, and create a sensible 2–4 week timeline. Ensure every task has an owner role.`;

function extractJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
}

app.get('/health', (req, res) => {
  res.json({ ok: true, model });
});

app.post('/api/analyze', upload.single('brief'), async (req, res, next) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Upload one PDF, PNG, or JPG file in the "brief" field.' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: req.file.mimetype,
                  data: req.file.buffer.toString('base64'),
                },
              },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.35,
          },
        }),
      },
    );

    const gemini = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: gemini?.error?.message || 'Gemini could not analyze this file.',
      });
    }

    const text = gemini?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('');
    if (!text) throw new Error('Gemini returned no plan.');

    return res.json(extractJson(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(502).json({ error: 'Gemini returned invalid JSON. Please retry.' });
    }
    return next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large. Maximum size is 15 MB.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Unable to analyze this brief. Please try again.' });
});

app.listen(port, () => {
  console.log(`TaskMate API listening on http://localhost:${port}`);
});
