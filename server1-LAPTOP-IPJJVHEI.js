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

// Add this near the top of your file, after importing express
const cors = require('cors');
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));



app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// --- isAdmin Middleware ---
function isAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

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

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  customerId: String,
  customername: String,
  provider: String,
  duration: Number,
  packs: [String],
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  total: Number,
  recharged: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Subscription = mongoose.model('Subscription', subscriptionSchema);

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
  req.session.admin = { username, isAdmin: true };
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
  req.session.user = { id: user._id.toString(), name: user.name, email: user.email, customerId: user.customerId };
  res.redirect('/userdashboard');
});

// Middleware to protect user routes
function isApiAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.status(401).json({ message: 'Unauthorized. Please log in.' });
}
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    res.redirect('/login');
  }
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

// Get complaints - Admin or user
app.get('/get-complaints', async (req, res) => {
  if (req.session.admin) {
    const complaints = await Complaint.find().sort({ createdAt: -1 });
    return res.json(complaints);
  }
  if (req.session.user) {
    const user = await User.findById(req.session.user.id);
    const complaints = await Complaint.find({ customerId: user.customerId }).sort({ createdAt: -1 });
    return res.json(complaints);
  }
  res.status(401).json({ message: 'Unauthorized' });
});

app.put('/update-complaint/:id', async (req, res) => {
  let { status, employeeName } = req.body;
  // Standardize status to "Solved" or "Pending"
  if (status && status.toLowerCase() === "solved") status = "Solved";
  if (status && status.toLowerCase() === "pending") status = "Pending";
  if (status && status.toLowerCase() === "resolved") status = "Solved"; // <-- ADD THIS LINE
  try {
    await Complaint.findByIdAndUpdate(req.params.id, { status, employeeName });
    res.status(200).json({ message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Update failed' });
  }
});



// Get all users - Admin only
app.get('/get-users', isAdmin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// Logged-in user details
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

// Update user details
app.put('/update-user', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Not logged in' });
  const { name, email, phone, address, city, zip, package: pkg, connectionDate } = req.body;
  try {
    const user = await User.findById(req.session.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.address = address || user.address;
    user.city = city || user.city;
    user.zip = zip || user.zip;
    user.package = pkg || user.package;
    user.connectionDate = connectionDate || user.connectionDate;
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Error updating user data', error: err.message });
  }
});

// Get logged-in user short info
app.get('/get-logged-in-user', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Not logged in' });
  const user = await User.findById(req.session.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ customerId: user.customerId, name: user.name });
});

// Password reset
app.get('/user/forgot-password', (req, res) => {
  res.sendFile(__dirname + '/public/userforgotpassword.html');
});
app.post('/user/reset-password', async (req, res) => {
  const { email, newPassword, confirmPassword } = req.body;
  if (newPassword !== confirmPassword) {
    return res.send('Passwords do not match.');
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await User.updateOne({ email }, { $set: { password: hashedPassword } });
    if (result.modifiedCount === 0) {
      return res.send('User not found or password not updated.');
    }
    res.send('Password successfully updated. You can now <a href="/userlogin.html">login</a>.');
  } catch (err) {
    res.send('Error updating password. Please try again.');
  }
});

// Get user details for session
app.get('/getUserDetails', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json({
    name: req.session.user.name,
    customerId: req.session.user.customerId
  });
});

// ---- DTH Subscription API with startDate and endDate ----
app.post('/api/subscribe', isApiAuthenticated, async (req, res) => {
  try {
    const { provider, duration, packs, startDate, endDate, total } = req.body;
    if (!provider || !duration || !Array.isArray(packs) || packs.length === 0 || !startDate || !endDate || typeof total === 'undefined') {
      return res.status(400).json({ message: 'All fields required' });
    }
    const user = await User.findById(req.session.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const subscription = new Subscription({
      userId: user._id,
      customerId: user.customerId,
      customername: user.name,
      provider,
      duration: Number(duration),
      packs,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      total: Number(total),
      recharged: false
    });
    await subscription.save();
    await User.findByIdAndUpdate(user._id, {
      $push: {
        subscriptionPacks: {
          provider,
          duration: Number(duration),
          packs,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          total: Number(total),
          subscribedAt: new Date()
        }
      }
    });
    res.json({
      message: 'Subscription successful!',
      customerId: user.customerId,
      customername: user.name
    });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ message: 'Subscription failed' });
  }
});



app.post('/api/mark-recharged', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: 'Not logged in' });
  try {
    // Find the latest subscription for this user
    const sub = await Subscription.findOne({ userId: req.session.user.id }).sort({ createdAt: -1 });
    if (!sub) return res.status(404).json({ message: 'No subscription found' });
    if (sub.recharged) return res.status(400).json({ message: 'Already recharged' });

    sub.recharged = true;
    await sub.save();

    // Fetch user email
    const user = await User.findById(req.session.user.id);

    // Send mail, but don't fail the recharge if mail sending fails
    if (user && user.email) {
      let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'r363523@gmail.com',
          pass: 'fxif viqb czdb fdio'
        }
      });

      let mailOptions = {
        from: '"DTH Service" <r363523@gmail.com>',
        to: user.email,
        subject: 'Recharge Successful',
        html: `
          <h2>Dear ${user.name},</h2>
          <p>Your subscription recharge has been <b>successfully processed</b>!</p>
          <ul>
            <li><b>Provider:</b> ${sub.provider}</li>
            <li><b>Packs:</b> ${sub.packs.join(', ')}</li>
            <li><b>Duration:</b> ${sub.duration} months</li>
            <li><b>Start Date:</b> ${sub.startDate.toDateString()}</li>
            <li><b>End Date:</b> ${sub.endDate.toDateString()}</li>
            <li><b>Total Paid:</b> ₹${sub.total}</li>
          </ul>
          <p>Thank you for using our service!</p>
        `
      };

      transporter.sendMail(mailOptions)
        .then(() => {
          console.log('Mail sent');
        })
        .catch((err) => {
          console.error('Mail sending failed:', err);
        });
    }

    // Always respond with success if recharge is marked
    res.json({ message: 'Recharge marked successfully. Email sent if possible.' });
  } catch (err) {
    console.error('Recharge or mail error:', err);
    res.status(500).json({ message: 'Failed to mark recharge.' });
  }
});


// Store Receipts API (store one or more receipts)
app.post('/api/receipts', isApiAuthenticated, async (req, res) => {
  try {
    let receipts = req.body;
    if (!Array.isArray(receipts)) receipts = [receipts];
    const user = await User.findById(req.session.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const saved = [];
    for (const r of receipts) {
      if (!r.provider || !r.duration || !Array.isArray(r.packs) || !r.startDate || !r.endDate || typeof r.total === 'undefined') {
        return res.status(400).json({ message: 'Missing required fields in receipt' });
      }
      const subscription = new Subscription({
        userId: user._id,
        customerId: user.customerId,
        customername: user.name,
        provider: r.provider,
        duration: Number(r.duration),
        packs: r.packs,
        startDate: new Date(r.startDate),
        endDate: new Date(r.endDate),
        total: Number(r.total),
        recharged: true,
        createdAt: r.createdAt ? new Date(r.createdAt) : new Date()
      });
      await subscription.save();
      saved.push(subscription);
    }
    res.status(201).json({ message: 'Receipts stored successfully', receipts: saved });
  } catch (err) {
    console.error('Error storing receipts:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Fetch all subscriptions (for admin/report)
app.get('/api/subscriptions', isAdmin, async (req, res) => {
  try {
    const subs = await Subscription.find().lean();
    const mapped = subs.map(sub => ({
      customerId: sub.customerId,
      name: sub.customername || sub.name || '-',
      provider: sub.provider,
      duration: sub.duration,
      packs: sub.packs,
      startDate: sub.startDate,
      endDate: sub.endDate,
      total: sub.total,
      recharged: sub.recharged,
      createdAt: sub.createdAt
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// OTP Password Reset Implementation ----

// Add these to your existing code:

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'r363523@gmail.com',
    pass: 'fxif viqb czdb fdio'
  }
});

// Generate random 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// In-memory OTP storage (use Redis or DB for production)
const otpStorage = new Map();

// Send OTP endpoint
app.post('/user/send-otp', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Email not registered' });

    const otp = generateOTP();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    otpStorage.set(email, { otp, expiresAt });

    await transporter.sendMail({
      from: 'Cable Management <noreply@example.com>',
      to: email,
      subject: 'Password Reset OTP',
      html: `<p>Your OTP for password reset is: <strong>${otp}</strong></p>
             <p>This OTP is valid for 5 minutes.</p>`
    });

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ error: 'Error sending OTP' });
  }
});


// Verify OTP and reset password endpoint
// Replace your existing reset-password endpoint with this:
app.post('/user/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  try {
    const stored = otpStorage.get(email);
    if (!stored || stored.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
    if (Date.now() > stored.expiresAt) {
      otpStorage.delete(email);
      return res.status(400).json({ error: 'OTP expired' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    otpStorage.delete(email);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Error resetting password' });
  }
});


// Admin: Get all recharged receipts
app.get('/api/all-receipts', isAdmin, async (req, res) => {
  try {
    const receipts = await Subscription.find({ recharged: true }).sort({ createdAt: -1 });
    res.json(receipts);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Latest subscription for receipt
app.get('/api/my-latest-subscription', isApiAuthenticated, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ userId: req.session.user.id })
      .sort({ createdAt: -1 })
      .lean();
    if (!sub) return res.status(404).json({ message: 'No subscription found' });
    res.json({
      customerId: sub.customerId,
      name: sub.customername || sub.name || '-',
      provider: sub.provider,
      duration: sub.duration,
      packs: sub.packs,
      startDate: sub.startDate,
      endDate: sub.endDate,
      total: sub.total,
      recharged: sub.recharged,
      createdAt: sub.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch subscription' });
  }
});

// Only show recharged subscriptions in receipts
app.get('/api/my-subscriptions', isApiAuthenticated, async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.session.user.id, recharged: true }).sort({ createdAt: -1 }).lean();
    const mapped = subs.map(sub => ({
      customerId: sub.customerId,
      name: sub.customername || sub.name || '-',
      provider: sub.provider,
      duration: sub.duration,
      packs: sub.packs,
      startDate: sub.startDate,
      endDate: sub.endDate,
      total: sub.total,
      recharged: sub.recharged,
      createdAt: sub.createdAt
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json([]);
  }
});

// ---- Analytics API: Packages per Month ----
app.get('/api/stats/packages-per-month', isAdmin, async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const result = await Subscription.aggregate([
      { $match: { recharged: true, createdAt: { $gte: start } } },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);
    const labels = [];
    const data = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const label = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      labels.push(label);
      const found = result.find(r => r._id.year === date.getFullYear() && r._id.month === date.getMonth() + 1);
      data.push(found ? found.count : 0);
    }
    res.json({ labels, data });
  } catch (err) {
    res.status(500).json({ labels: [], data: [] });
  }
});

// Get total subscriptions by DTH provider (for admin)
app.get('/api/stats/subscriptions-by-provider', isAdmin, async (req, res) => {
  try {
    const result = await Subscription.aggregate([
      { $match: { recharged: true } },
      { $group: { _id: "$provider", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json({
      labels: result.map(r => r._id),
      data: result.map(r => r.count)
    });
  } catch (err) {
    res.status(500).json({ labels: [], data: [] });
  }
});

app.get('/api/stats/revenue-per-month', isAdmin, async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const result = await Subscription.aggregate([
      { $match: { recharged: true, createdAt: { $gte: start } } },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          revenue: { $sum: "$total" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);
    const labels = [];
    const data = [];
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const label = date.toLocaleString('default', { month: 'short', year: 'numeric' });
      labels.push(label);
      const found = result.find(r => r._id.year === date.getFullYear() && r._id.month === date.getMonth() + 1);
      data.push(found ? found.revenue : 0);
    }
    res.json({ labels, data });
  } catch (err) {
    res.status(500).json({ labels: [], data: [] });
  }
});

// Example using Mongoose
const EMPLOYEES = Array.from(new Set(Object.values(employeeMapping)));

// Build a mapping: employee -> [complaint categories]
const employeeToCategories = {};
Object.entries(employeeMapping).forEach(([category, emp]) => {
  if (!employeeToCategories[emp]) employeeToCategories[emp] = [];
  employeeToCategories[emp].push(category);
});

app.get('/api/stats/complaints-by-employee', async (req, res) => {
  try {
    // Group complaints by employee and status (case-insensitive)
    const complaints = await Complaint.aggregate([
      {
        $group: {
          _id: { employee: "$employeeName", status: { $toLower: "$status" } },
          count: { $sum: 1 }
        }
      }
    ]);

    // Initialize stats for all employees and Unassigned
    const employeeStats = {};
    EMPLOYEES.forEach(emp => {
      employeeStats[emp] = { solved: 0, pending: 0 };
    });
    employeeStats["Unassigned"] = { solved: 0, pending: 0 };

    // Fill in stats from aggregation
    complaints.forEach(c => {
      const emp = c._id.employee || "Unassigned";
      if (!employeeStats[emp]) {
        employeeStats[emp] = { solved: 0, pending: 0 };
      }
      // Accept both "solved" and "resolved" as solved
      if (c._id.status === "solved" || c._id.status === "resolved") {
        employeeStats[emp].solved += c.count;
      } else {
        employeeStats[emp].pending += c.count;
      }
    });

    // Prepare result array, including complaint categories for each employee
    let result = [...EMPLOYEES, "Unassigned"].map(emp => ({
      employee: emp,
      solved: employeeStats[emp].solved,
      pending: employeeStats[emp].pending,
      complaints: employeeToCategories[emp] || []
    }));

    // Sort by solved complaints in descending order
    result.sort((a, b) => b.solved - a.solved);

    res.json(result);
  } catch (err) {
    console.error("Error in complaints-by-employee API:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ---- LOGOUT ----
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ---- Start Server ----
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
