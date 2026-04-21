const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/cable_operator', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.log('MongoDB connection error:', err);
});

// Schemas
const adminSchema = new mongoose.Schema({
  username: String,
  password: String
});
const Admin = mongoose.model('Admin', adminSchema);

const userSchema = new mongoose.Schema({
  customerId: String,
  name: String,
  email: String,
  phone: String,
  password: String,
  address: String,
  city: String,
  zip: String,
  package: String,
  connectionDate: Date,
  status: { type: String, default: 'Active' },
  createdAt: { type: Date, default: Date.now },
  resetOTP: String,
  otpExpiresAt: Date
});
const User = mongoose.model('User', userSchema);

const complaintSchema = new mongoose.Schema({
  customerId: String,
  customerName: String,
  complaintText: String,
  complaintCategory: String,
  employeeName: String,
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});
const Complaint = mongoose.model('Complaint', complaintSchema);

// Auto-create admin
async function checkAdminExists() {
  const exists = await Admin.findOne();
  if (!exists) {
    const hash = await bcrypt.hash('adminPassword', 10);
    await new Admin({ username: 'admin', password: hash }).save();
    console.log('Default admin created: admin/adminPassword');
  }
}
checkAdminExists();

// Helper: Customer ID generator
async function generateCustomerId() {
  const lastUser = await User.findOne().sort({ _id: -1 });
  let lastId = 1000;
  if (lastUser && lastUser.customerId) {
    const match = lastUser.customerId.match(/CUST(\d+)/);
    if (match) lastId = parseInt(match[1], 10);
  }
  return `CUST${lastId + 1}`;
}

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: 'your.email@gmail.com',
    pass: 'your-email-password' // Use App Password if 2FA is on
  }
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin login
app.post('/adminlogin', async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });
  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }
  req.session.admin = { username };
  res.redirect('/admindashboard');
});

app.get('/admindashboard', (req, res) => {
  if (!req.session.admin) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'admindashboard.html'));
});

// User registration
app.post('/register', async (req, res) => {
  const { name, email, phone, password, address, city, zip, package: pkg, connectionDate } = req.body;
  if (!name || !email || !phone || !password || !address || !city || !zip || !pkg || !connectionDate) {
    return res.status(400).json({ message: 'All fields required' });
  }

  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: 'Email already registered' });

  const customerId = await generateCustomerId();
  const hash = await bcrypt.hash(password, 10);

  await new User({
    customerId,
    name,
    email,
    phone,
    password: hash,
    address,
    city,
    zip,
    package: pkg,
    connectionDate,
    status: 'Active'
  }).save();

  res.redirect('/userlogin.html');
});

// User login
app.post('/userlogin', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }
  req.session.user = { id: user._id.toString(), name: user.name, email: user.email };
  res.redirect('/userdashboard');
});

// Middleware to protect user routes
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/userlogin.html');
}

// User dashboard
app.get('/userdashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'userdashboard.html'));
});

// Complaint submission
const employeeMapping = {
  "No Signal / Channel Not Working": "Amit Sharma",
  "Poor Picture or Sound Quality": "Priya Gupta",
  "Set-Top Box Issues": "Ravi Kumar",
  "Billing or Payment Issues": "Neha Yadav",
  "Package Subscription Issues": "Arvind Patel",
  "Late or Missed Service": "Suresh Reddy",
  "Remote Control Not Working": "Deepika Joshi",
  "Customer Service Complaints": "Vikram Singh",
  "Internet Connectivity": "Sita Mehta",
  "Request for Disconnection or Suspension": "Rajesh Nair",
  "Others": "Kavita Desai"
};

app.post('/submit-complaint', async (req, res) => {
  const { customerId, customerName, complaintText, complaintCategory } = req.body;
  const trimmedCategory = complaintCategory?.trim();
  const employeeName = employeeMapping[trimmedCategory] || "Amit Sharma";

  try {
    await new Complaint({
      customerId,
      customerName,
      complaintText,
      complaintCategory: trimmedCategory,
      employeeName
    }).save();
    res.status(200).json({ message: 'Complaint submitted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error saving complaint', error: err.message });
  }
});

// Admin: Get all complaints
app.get('/get-complaints', async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ createdAt: -1 });
    res.json(complaints);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching complaints' });
  }
});

// Admin: Update complaint
app.put('/update-complaint/:id', async (req, res) => {
  const { status, employeeName } = req.body;
  try {
    await Complaint.findByIdAndUpdate(req.params.id, { status, employeeName });
    res.status(200).json({ message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Update failed' });
  }
});

// Admin: Get all users
app.get('/get-users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// User: Get details
app.get('/get-user-details', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Not logged in' });
  try {
    const user = await User.findById(req.session.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching user data' });
  }
});

// Update user profile
app.put('/update-user', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Not logged in' });

  const { name, email, phone, address, city, zip, package, connectionDate } = req.body;

  try {
    const user = await User.findById(req.session.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.address = address || user.address;
    user.city = city || user.city;
    user.zip = zip || user.zip;
    user.package = package || user.package;
    user.connectionDate = connectionDate || user.connectionDate;

    await user.save();
    res.json(user);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Error updating user data' });
  }
});

// 🔐 Forgot Password Flow
app.post('/user/send-otp', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: 'User not found' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date(Date.now() + 10 * 60000); // 10 minutes

  user.resetOTP = otp;
  user.otpExpiresAt = expiry;
  await user.save();

  await transporter.sendMail({
    to: user.email,
    subject: 'Password Reset OTP',
    html: `<p>Your OTP is <strong>${otp}</strong>. It expires in 10 minutes.</p>`
  });

  res.json({ message: 'OTP sent to your email.' });
});

app.post('/user/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email, resetOTP: otp });

  if (!user || new Date() > user.otpExpiresAt) {
    return res.status(400).json({ message: 'Invalid or expired OTP.' });
  }

  res.json({ message: 'OTP verified. Proceed to reset password.' });
});

app.post('/user/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const user = await User.findOne({ email, resetOTP: otp });

  if (!user || new Date() > user.otpExpiresAt) {
    return res.status(400).json({ message: 'Invalid or expired OTP.' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetOTP = null;
  user.otpExpiresAt = null;
  await user.save();

  res.json({ message: 'Password successfully reset. You can now log in.' });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
