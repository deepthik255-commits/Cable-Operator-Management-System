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

// Initialize Router
const router = express.Router();

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
  subscriptionPacks: { type: Array, default: [] }
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

// Schema for Billing
const billingSchema = new mongoose.Schema({
  customerId: String,
  customerName: String,
  selectedPackages: [Object],
  dthProvider: String,
  billingCycle: String,
  totalAmount: Number
});

const BillingModel = mongoose.model('Billing', billingSchema);

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

// Customer ID generator
async function generateCustomerId() {
  const lastUser = await User.findOne().sort({ _id: -1 });
  let lastId = 1000;
  if (lastUser && lastUser.customerId) {
    const match = lastUser.customerId.match(/CUST(\d+)/);
    if (match) lastId = parseInt(match[1], 10);
  }
  return `CUST${lastId + 1}`;
}

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
  if (!req.session.user) {
    return res.status(401).json({ message: 'Unauthorized. Please log in.' });
  }

  const { complaintText, complaintCategory } = req.body;
  const user = await User.findById(req.session.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const trimmedCategory = complaintCategory?.trim();
  const employeeName = employeeMapping[trimmedCategory] || "Amit Sharma";

  const newComplaint = new Complaint({
    customerId: user.customerId,
    customerName: user.name,
    complaintText,
    complaintCategory: trimmedCategory,
    employeeName
  });

  await newComplaint.save();
  res.json({ message: 'Complaint submitted successfully' });
});

// Route to save selected package and billing summary
router.post('/selectPackage', async (req, res) => {
  const { customerId, customerName, package, dthProvider, billingCycle } = req.body;

  // Calculate the total amount
  const dthPrices = {
    "Tata Play": { monthly: 150, yearly: 1600 },
    "Airtel Digital TV": { monthly: 145, yearly: 1550 },
    "Dish TV": { monthly: 140, yearly: 1500 },
    "Sun Direct": { monthly: 130, yearly: 1450 },
    "d2h": { monthly: 135, yearly: 1480 },
    "Reliance Digital TV": { monthly: 120, yearly: 1350 },
    "Zing Digital": { monthly: 125, yearly: 1400 }
  };

  const selectedPackages = req.body.selectedPackages || [];
  const packTotal = selectedPackages.reduce((sum, p) => {
    const price = parseFloat(p.price.replace(/[^\d.]/g, ""));
    return sum + price;
  }, 0);

  const dthCharge = dthPrices[dthProvider][billingCycle];
  const totalAmount = packTotal + dthCharge;

  // Save the billing info to the database
  const billingInfo = new BillingModel({
    customerId,
    customerName,
    selectedPackages,
    dthProvider,
    billingCycle,
    totalAmount
  });

  await billingInfo.save();

  // Send response to frontend
  res.json({ message: 'Package and billing summary saved successfully!' });
});

// Apply router to the app
app.use('/api', router);

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
