const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('store.sqlite');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// OxaPay API (само този ще използваме)
const OXAPAY_API_KEY = 'FGUKRJ-99OGIU-GJUEAB-SO5IM7';

// Initialize database
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        image TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Orders table
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id INTEGER,
        quantity INTEGER DEFAULT 1,
        total_amount REAL NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        payment_id TEXT,
        crypto_address TEXT,
        crypto_amount TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`);

    // Add sample products
    db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
        if (!err && row.count === 0) {
            const products = [
                ['Premium Package', 'High-quality digital product', 29.99, 'https://via.placeholder.com/300x200/007bff/ffffff?text=Premium'],
                ['Standard Package', 'Good value for money', 19.99, 'https://via.placeholder.com/300x200/28a745/ffffff?text=Standard'],
                ['Basic Package', 'Essential features', 9.99, 'https://via.placeholder.com/300x200/ffc107/ffffff?text=Basic']
            ];
            products.forEach(product => {
                db.run("INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)", product);
            });
        }
    });

    // Create admin user
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (!err && row.count === 0) {
            bcrypt.hash('admin123', 10, (err, hash) => {
                if (!err) {
                    db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', hash]);
                }
            });
        }
    });
});

// Simple session management
const sessions = {};

function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'] || req.query.session;
    if (sessionId && sessions[sessionId]) {
        req.user = sessions[sessionId];
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes
app.get('/', (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, products) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        res.render('index', { products, user: null });
    });
});

// Auth routes
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.render('register', { error: 'Username and password required' });
    }

    if (password.length < 6) {
        return res.render('register', { error: 'Password must be at least 6 characters' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
            return res.render('register', { error: 'Registration failed' });
        }

        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], function(err) {
            if (err) {
                return res.render('register', { error: 'Username already exists' });
            }
            res.redirect('/login?success=1');
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err || !user) {
            return res.render('login', { error: 'Invalid credentials' });
        }

        bcrypt.compare(password, user.password, (err, match) => {
            if (err || !match) {
                return res.render('login', { error: 'Invalid credentials' });
            }

            const sessionId = crypto.randomBytes(32).toString('hex');
            sessions[sessionId] = user;
            
            res.cookie('sessionId', sessionId);
            res.redirect('/dashboard');
        });
    });
});

app.get('/dashboard', requireAuth, (req, res) => {
    db.all("SELECT * FROM products ORDER BY id DESC", [], (err, products) => {
        if (err) {
            return res.status(500).send('Database error');
        }
        
        db.all(`
            SELECT o.*, p.name as product_name 
            FROM orders o 
            JOIN products p ON o.product_id = p.id 
            WHERE o.user_id = ? 
            ORDER BY o.created_at DESC
        `, [req.user.id], (err, orders) => {
            if (err) {
                console.error(err);
                orders = [];
            }
            res.render('dashboard', { products, orders, user: req.user });
        });
    });
});

app.get('/logout', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (sessionId) {
        delete sessions[sessionId];
    }
    res.clearCookie('sessionId');
    res.redirect('/');
});

// Buy product
app.post('/buy/:productId', requireAuth, (req, res) => {
    const productId = req.params.productId;
    const quantity = parseInt(req.body.quantity) || 1;

    db.get("SELECT * FROM products WHERE id = ?", [productId], async (err, product) => {
        if (err || !product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const totalAmount = product.price * quantity;

        // Create order
        db.run(
            "INSERT INTO orders (user_id, product_id, quantity, total_amount) VALUES (?, ?, ?, ?)",
            [req.user.id, productId, quantity, totalAmount],
            async function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create order' });
                }

                const orderId = this.lastID;

                try {
                    // Create OxaPay payment
                    const paymentData = {
                        merchant: OXAPAY_API_KEY,
                        amount: totalAmount,
                        currency: 'USD',
                        lifeTime: 30,
                        feePaidByPayer: 0,
                        underPaidCover: 5,
                        callbackUrl: `${req.protocol}://${req.get('host')}/webhook/oxapay`,
                        returnUrl: `${req.protocol}://${req.get('host')}/payment-success`,
                        description: `Order #${orderId} - ${product.name}`
                    };

                    const response = await axios.post('https://api.oxapay.com/merchants/request', paymentData);
                    
                    if (response.data.result === 100) {
                        // Update order with payment details
                        db.run(
                            "UPDATE orders SET payment_id = ?, crypto_address = ? WHERE id = ?",
                            [response.data.trackId, response.data.payLink, orderId]
                        );

                        res.json({
                            success: true,
                            paymentId: response.data.trackId,
                            paymentUrl: response.data.payLink,
                            orderId: orderId
                        });
                    } else {
                        throw new Error('Payment creation failed');
                    }

                } catch (paymentError) {
                    console.error('Payment error:', paymentError);
                    res.status(500).json({ error: 'Payment creation failed' });
                }
            }
        );
    });
});

// Webhook
app.post('/webhook/oxapay', (req, res) => {
    console.log('OxaPay webhook:', req.body);
    
    if (req.body.status === 'Paid') {
        db.run(
            "UPDATE orders SET payment_status = 'completed' WHERE payment_id = ?",
            [req.body.trackId],
            (err) => {
                if (err) {
                    console.error('Webhook error:', err);
                }
            }
        );
    }
    
    res.status(200).send('OK');
});

// Payment success page
app.get('/payment-success', (req, res) => {
    res.render('success');
});

// Admin routes
app.get('/admin', (req, res) => {
    res.render('admin_login', { error: null });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin123') {
        const sessionId = crypto.randomBytes(32).toString('hex');
        sessions[sessionId] = { id: 0, username: 'admin', isAdmin: true };
        res.cookie('sessionId', sessionId);
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin_login', { error: 'Invalid credentials' });
    }
});

app.get('/admin/dashboard', (req, res) => {
    const sessionId = req.cookies.sessionId;
    if (!sessionId || !sessions[sessionId] || !sessions[sessionId].isAdmin) {
        return res.redirect('/admin');
    }

    db.all(`
        SELECT o.*, u.username, p.name as product_name 
        FROM orders o 
        LEFT JOIN users u ON o.user_id = u.id 
        LEFT JOIN products p ON o.product_id = p.id 
        ORDER BY o.created_at DESC
    `, [], (err, orders) => {
        if (err) {
            console.error(err);
            orders = [];
        }

        db.all("SELECT * FROM products ORDER BY id DESC", [], (err, products) => {
            if (err) {
                console.error(err);
                products = [];
            }
            res.render('admin_dashboard', { orders, products });
        });
    });
});

app.listen(port, () => {
    console.log(`🚀 Crypto Store running on port ${port}`);
    console.log(`💎 OxaPay integration active`);
    console.log(`👤 Default admin: admin / admin123`);
});
