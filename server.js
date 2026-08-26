const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
const model = 'gemini-3.6-flash';

app.use(cors());
app.use(express.json({ limit: '15mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const prompt = `Analyze this project brief. Return a COMPLETE team project plan with:
- Project summary (1 sentence)
- 5-10 tasks with: name, estimated_hours (number), priority (high/medium/low)
- 3-5 team roles with: role name, tasks (array of task names)
- 4-week timeline with weekly breakdown
- Budget estimate: "low" / "medium" / "high"
- Key risks: array of { risk, mitigation }
- Success metrics: array of strings

Return ONLY valid JSON with this exact structure:
{
  "project_summary": "...",
  "tasks": [{"name":"...","estimated_hours":2,"priority":"high"}],
  "team_roles": [{"role":"...","tasks":["task1","task2"]}],
  "timeline": {"week1":["Task A"],"week2":["Task B"]},
  "budget": "medium",
  "risks": [{"risk":"...","mitigation":"..."}],
  "success_metrics": ["..."]
}`;

function extractJson(text) {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/generate', upload.single('file'), async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not set on server' });
    }

    const fileData = req.body.file || req.file?.buffer?.toString('base64');
    const mimeType = req.body.mimeType || req.file?.mimetype;

    if (!fileData || !mimeType) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mimeType, data: fileData } }
            ]
          }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Gemini API error');

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!text) throw new Error('No response from Gemini');

    const parsed = extractJson(text);
    res.json(parsed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`TaskMate backend running on port ${port}`);
});
