const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database('store.sqlite');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// API Configuration
const WOLVPAY_API_KEY = 'wlov_live_70b44b3fb1bc51c5f3c2f4757904e7e3';
const WOLVPAY_WEBHOOK = 'c2d12939cdabd9cfbf9bf615a8f697f7b6ab0066bece629784657bb4171fa401';
const OXAPAY_API_KEY = 'FGUKRJ-99OGIU-GJUEAB-SO5IM7';

// Initialize database tables
db.serialize(() => {
    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        image TEXT
    )`);

    // Orders table with crypto payment support
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_email TEXT NOT NULL,
        total_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        crypto_address TEXT,
        crypto_amount TEXT,
        crypto_currency TEXT,
        payment_id TEXT,
        webhook_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Order items table
    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        product_id INTEGER,
        quantity INTEGER,
        price REAL,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`);
});

// Routes
app.get('/', (req, res) => {
    db.all("SELECT * FROM products", [], (err, products) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        res.render('index', { products });
    });
});

app.get('/product/:id', (req, res) => {
    const productId = req.params.id;
    db.get("SELECT * FROM products WHERE id = ?", [productId], (err, product) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        if (!product) {
            return res.status(404).send('Product not found');
        }
        res.render('product', { product });
    });
});

app.get('/checkout', (req, res) => {
    const cartItems = req.query.items ? JSON.parse(req.query.items) : [];
    let total = 0;
    
    if (cartItems.length > 0) {
        const productIds = cartItems.map(item => item.id).join(',');
        db.all(`SELECT * FROM products WHERE id IN (${productIds})`, [], (err, products) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }
            
            const cartWithDetails = cartItems.map(cartItem => {
                const product = products.find(p => p.id == cartItem.id);
                const itemTotal = product.price * cartItem.quantity;
                total += itemTotal;
                return {
                    ...product,
                    quantity: cartItem.quantity,
                    itemTotal: itemTotal
                };
            });
            
            res.render('checkout', { 
                cartItems: cartWithDetails, 
                total: total.toFixed(2)
            });
        });
    } else {
        res.render('checkout', { cartItems: [], total: '0.00' });
    }
});

// WolvPay payment creation
async function createWolvPayPayment(orderData) {
    try {
        const response = await axios.post('https://api.wolvpay.com/v1/payments', {
            amount: orderData.total,
            currency: 'USD',
            order_id: orderData.orderId,
            callback_url: `${process.env.BASE_URL || 'http://localhost:3000'}/webhook/wolvpay`,
            customer_email: orderData.email
        }, {
            headers: {
                'Authorization': `Bearer ${WOLVPAY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('WolvPay API Error:', error.response?.data || error.message);
        throw error;
    }
}

// OxaPay payment creation
async function createOxaPayPayment(orderData) {
    try {
        const response = await axios.post('https://api.oxapay.com/merchants/request', {
            merchant: OXAPAY_API_KEY,
            amount: orderData.total,
            currency: 'USD',
            lifeTime: 30,
            feePaidByPayer: 0,
            underPaidCover: 5,
            callbackUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/webhook/oxapay`,
            returnUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/payment-success`,
            description: `Order #${orderData.orderId}`
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        return response.data;
    } catch (error) {
        console.error('OxaPay API Error:', error.response?.data || error.message);
        throw error;
    }
}

// Process payment
app.post('/process-payment', async (req, res) => {
    const { email, cartItems, total, paymentMethod } = req.body;
    
    try {
        // Create order in database
        db.run(
            "INSERT INTO orders (customer_email, total_amount, payment_method) VALUES (?, ?, ?)",
            [email, total, paymentMethod],
            async function(err) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Failed to create order' });
                }
                
                const orderId = this.lastID;
                
                // Add order items
                const cartData = JSON.parse(cartItems);
                for (const item of cartData) {
                    db.run(
                        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
                        [orderId, item.id, item.quantity, item.price]
                    );
                }
                
                const orderData = {
                    orderId: orderId,
                    email: email,
                    total: parseFloat(total)
                };
                
                try {
                    let paymentResponse;
                    
                    if (paymentMethod === 'wolvpay') {
                        paymentResponse = await createWolvPayPayment(orderData);
                        
                        // Update order with payment details
                        db.run(
                            "UPDATE orders SET payment_id = ?, crypto_address = ?, crypto_amount = ?, crypto_currency = ? WHERE id = ?",
                            [paymentResponse.payment_id, paymentResponse.address, paymentResponse.amount, paymentResponse.currency, orderId]
                        );
                        
                        res.json({
                            success: true,
                            paymentUrl: paymentResponse.payment_url,
                            paymentDetails: {
                                address: paymentResponse.address,
                                amount: paymentResponse.amount,
                                currency: paymentResponse.currency,
                                qr_code: paymentResponse.qr_code
                            }
                        });
                        
                    } else if (paymentMethod === 'oxapay') {
                        paymentResponse = await createOxaPayPayment(orderData);
                        
                        if (paymentResponse.result === 100) {
                            // Update order with payment details
                            db.run(
                                "UPDATE orders SET payment_id = ?, crypto_address = ?, crypto_amount = ?, crypto_currency = ? WHERE id = ?",
                                [paymentResponse.trackId, paymentResponse.payLink, paymentResponse.amount, paymentResponse.currency, orderId]
                            );
                            
                            res.json({
                                success: true,
                                paymentUrl: paymentResponse.payLink,
                                paymentDetails: {
                                    trackId: paymentResponse.trackId,
                                    amount: paymentResponse.amount,
                                    currency: paymentResponse.currency
                                }
                            });
                        } else {
                            throw new Error('OxaPay payment creation failed');
                        }
                    } else {
                        res.status(400).json({ error: 'Invalid payment method' });
                    }
                    
                } catch (paymentError) {
                    console.error('Payment creation error:', paymentError);
                    res.status(500).json({ error: 'Payment creation failed. Please try again.' });
                }
            }
        );
    } catch (error) {
        console.error('Order processing error:', error);
        res.status(500).json({ error: 'Failed to process order' });
    }
});

// WolvPay webhook
app.post('/webhook/wolvpay', (req, res) => {
    const webhookData = req.body;
    console.log('WolvPay Webhook received:', webhookData);
    
    // Verify webhook signature if needed
    const receivedSignature = req.headers['x-webhook-signature'];
    const expectedSignature = crypto.createHmac('sha256', WOLVPAY_WEBHOOK)
        .update(JSON.stringify(webhookData))
        .digest('hex');
    
    if (receivedSignature !== expectedSignature) {
        return res.status(401).send('Unauthorized');
    }
    
    // Update order status
    if (webhookData.status === 'completed') {
        db.run(
            "UPDATE orders SET payment_status = 'completed', webhook_data = ? WHERE payment_id = ?",
            [JSON.stringify(webhookData), webhookData.payment_id],
            (err) => {
                if (err) {
                    console.error('Failed to update order:', err);
                    return res.status(500).send('Failed to update order');
                }
                console.log(`Order with payment ID ${webhookData.payment_id} marked as completed`);
                res.status(200).send('OK');
            }
        );
    } else {
        res.status(200).send('OK');
    }
});

// OxaPay webhook
app.post('/webhook/oxapay', (req, res) => {
    const webhookData = req.body;
    console.log('OxaPay Webhook received:', webhookData);
    
    // Update order status
    if (webhookData.status === 'Paid') {
        db.run(
            "UPDATE orders SET payment_status = 'completed', webhook_data = ? WHERE payment_id = ?",
            [JSON.stringify(webhookData), webhookData.trackId],
            (err) => {
                if (err) {
                    console.error('Failed to update order:', err);
                    return res.status(500).send('Failed to update order');
                }
                console.log(`Order with track ID ${webhookData.trackId} marked as completed`);
                res.status(200).send('OK');
            }
        );
    } else {
        res.status(200).send('OK');
    }
});

// Payment success page
app.get('/payment-success', (req, res) => {
    res.send(`
        <div style="text-align: center; padding: 50px; font-family: Arial;">
            <h2>✅ Payment Successful!</h2>
            <p>Your order has been processed successfully.</p>
            <p>You will receive a confirmation email shortly.</p>
            <a href="/" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Continue Shopping</a>
        </div>
    `);
});

// Admin routes
app.get('/admin', (req, res) => {
    res.render('admin_login');
});

app.get('/admin/dashboard', (req, res) => {
    // Get orders with payment details
    db.all(`
        SELECT o.*, 
               COUNT(oi.id) as item_count
        FROM orders o 
        LEFT JOIN order_items oi ON o.id = oi.order_id 
        GROUP BY o.id 
        ORDER BY o.created_at DESC
    `, [], (err, orders) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Database error');
        }
        res.render('admin_dashboard', { orders });
    });
});

// Check payment status endpoint
app.get('/check-payment/:orderId', (req, res) => {
    const orderId = req.params.orderId;
    
    db.get("SELECT payment_status FROM orders WHERE id = ?", [orderId], (err, order) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        res.json({ status: order.payment_status });
    });
});

app.listen(port, () => {
    console.log(`🚀 Crypto Store running on port ${port}`);
    console.log(`💎 WolvPay and OxaPay integration active`);
});
