const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const pdfParse = require('pdf-parse');

dotenv.config();

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text;

    const { questionType, difficulty, customPrompt, numQuestions } = req.body;
    const n = parseInt(numQuestions) || 3;

    let prompt;
    if (customPrompt && customPrompt.trim() !== '') {
      prompt = `${customPrompt}\n\nText:\n"""${text.slice(0, 1500)}"""`;
    } else {
      const baseInstructions = {
        MCQ: `
Generate ${n} MCQ questions from the text.
Format:
[
  {
    "type": "MCQ",
    "question": "Question text",
    "options": ["A", "B", "C", "D"],
    "answer": "Correct option"
  }
]
Respond ONLY in JSON. No explanations or markdown.
        `,
        'Short Answer': `
Generate ${n} Short Answer questions.
Format:
[
  {
    "type": "Short Answer",
    "question": "What is ...?",
    "answer": "..."
  }
]
Respond ONLY in JSON. No explanations or markdown.
        `,
        'Long Answer': `
Generate ${n} Long Answer questions.
Format:
[
  {
    "type": "Long Answer",
    "question": "Explain ...",
    "answer": "Long detailed answer."
  }
]
Respond ONLY in JSON. No explanations or markdown.
        `
      };

      prompt = `${baseInstructions[questionType]}\n\nText:\n"""${text.slice(0, 1500)}"""`;
    }

    // Mistral API
    const response = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-medium',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const raw = response.data.choices[0].message.content.trim();

    let questions;
    try {
      // Clean minor issues like markdown
      const cleaned = raw
        .replace(/^```json/, '')
        .replace(/^```/, '')
        .replace(/```$/, '')
        .trim();

      questions = JSON.parse(cleaned);
    } catch (err) {
      console.error("⚠️ JSON parse failed. Raw content:\n", raw);
      return res.status(500).json({
        error: 'Invalid response from Mistral. Unable to parse JSON.',
        rawOutput: raw,
      });
    }

    res.json({ questions });

    // Clean up file
    fs.unlinkSync(req.file.path);
  } catch (error) {
    console.error('❌ Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
