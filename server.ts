import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for demo purposes (replace with proper database in production)
let prompts: any[] = [
  {
    id: 'demo-prompt-1',
    slug: 'hello-world',
    title: 'Hello World Prompt',
    description: 'A simple greeting prompt',
    tags: ['greeting', 'simple'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestVersion: {
      id: 'version-1',
      semanticVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      body: 'Hello! How can I help you today?'
    }
  },
  {
    id: 'demo-prompt-2',
    slug: 'code-review',
    title: 'Code Review Assistant',
    description: 'Help with code reviews',
    tags: ['coding', 'review'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestVersion: {
      id: 'version-1',
      semanticVersion: '1.0.0',
      updatedAt: new Date().toISOString(),
      body: 'Please review this code for:\n- Best practices\n- Security issues\n- Performance optimizations\n- Code readability'
    }
  }
];

// API Routes
app.get('/api/prompts', (req, res) => {
  res.json({ prompts });
});

app.post('/api/prompts', (req, res) => {
  const { slug, title, description, body, semanticVersion, changelog, tags } = req.body;

  const newPrompt = {
    id: `prompt-${Date.now()}`,
    slug,
    title,
    description,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestVersion: {
      id: `version-${Date.now()}`,
      semanticVersion,
      updatedAt: new Date().toISOString(),
      body
    }
  };

  prompts.push(newPrompt);
  res.json({ prompt: newPrompt });
});

app.put('/api/prompts/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, tags } = req.body;

  const promptIndex = prompts.findIndex(p => p.id === id);
  if (promptIndex === -1) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  prompts[promptIndex] = {
    ...prompts[promptIndex],
    title: title || prompts[promptIndex].title,
    description: description || prompts[promptIndex].description,
    tags: tags || prompts[promptIndex].tags,
    updatedAt: new Date().toISOString()
  };

  res.json({ prompt: prompts[promptIndex] });
});

app.post('/api/prompts/:promptId/versions', (req, res) => {
  const { promptId } = req.params;
  const { body, semanticVersion, changelog } = req.body;

  const promptIndex = prompts.findIndex(p => p.id === promptId);
  if (promptIndex === -1) {
    return res.status(404).json({ error: 'Prompt not found' });
  }

  const newVersion = {
    id: `version-${Date.now()}`,
    semanticVersion,
    updatedAt: new Date().toISOString(),
    body
  };

  prompts[promptIndex].latestVersion = newVersion;
  prompts[promptIndex].updatedAt = new Date().toISOString();

  res.json({ version: newVersion });
});

// Serve static files from the desktop build
app.use(express.static(path.join(__dirname, 'desktop/dist')));

// Catch all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'desktop/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Prompt Vault API server running on http://localhost:${PORT}`);
  console.log(`Web app available at http://localhost:${PORT}`);
});