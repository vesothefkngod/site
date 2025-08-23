const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const dbPath = path.join(__dirname, "db", "store.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_email TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT
  )`);
});

db.get("SELECT COUNT(*) as c FROM admin_users", (err, row) => {
  if (row && row.c === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.run("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)", ["admin", hash]);
    console.log("🛡️  Seeded admin user → username: admin / password: admin123");
  }
});

db.get("SELECT COUNT(*) as c FROM products", (err, row) => {
  if (row && row.c === 0) {
    const seed = [
      ["Худи Blackout", "Oversized, heavy cotton. Cyberpunk embroidery.", 89.00, "https://picsum.photos/seed/hoodie/400/300"],
      ["Шапка GhostCap", "Snapback, stealth logo, low-profile.", 29.00, "https://picsum.photos/seed/cap/400/300"],
      ["DarkMode Ebook", "Playbook: underground branding & ops.", 19.00, "https://picsum.photos/seed/ebook/400/300"],
      ["Sticker Pack VND", "10 premium matte stickers.", 9.90, "https://picsum.photos/seed/stickers/400/300"]
    ];
    const stmt = db.prepare("INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)");
    seed.forEach(p => stmt.run(p));
    stmt.finalize();
    console.log("🧪 Seeded test products.");
  }
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");

app.use(session({
  secret: "tumnata-mreja-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.admin) return res.redirect("/admin/login");
  next();
}

app.get("/", (req, res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", (err, products) => {
    res.render("index", { products });
  });
});

app.get("/product/:id", (req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, product) => {
    if (!product) return res.status(404).send("Product not found");
    res.render("product", { product });
  });
});

app.post("/checkout/:id", (req, res) => {
  const pid = req.params.id;
  const email = req.body.email || null;
  db.run("INSERT INTO orders (product_id, user_email, status) VALUES (?, ?, 'pending')",
    [pid, email], function (err) {
      if (err) return res.status(500).send("Order error");
      res.render("checkout", { orderId: this.lastID, provider: null });
    });
});

app.get("/admin/login", (req, res) => {
  res.render("admin_login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM admin_users WHERE username = ?", [username], (err, user) => {
    if (!user) return res.render("admin_login", { error: "Невалидни данни" });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.render("admin_login", { error: "Невалидни данни" });
    req.session.admin = { id: user.id, username: user.username };
    res.redirect("/admin");
  });
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

app.get("/admin", requireAdmin, (req, res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", (err, products) => {
    db.all("SELECT o.id, o.status, o.created_at, p.name as product_name, p.price FROM orders o JOIN products p ON p.id = o.product_id ORDER BY o.id DESC",
      (err2, orders) => {
        res.render("admin_dashboard", { products, orders, admin: req.session.admin });
      });
  });
});

app.post("/admin/product/add", requireAdmin, (req, res) => {
  const { name, description, price, image } = req.body;
  db.run("INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)",
    [name, description, price, image || ""], () => res.redirect("/admin"));
});

app.post("/admin/product/delete/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM products WHERE id = ?", [req.params.id], () => res.redirect("/admin"));
});

app.post("/pay/wolvpay/:orderId", (req, res) => {
  const orderId = req.params.orderId;
  res.send(`WolvPay flow pending setup for order ${orderId}`);
});

app.post("/pay/oxapay/:orderId", (req, res) => {
  const orderId = req.params.orderId;
  res.send(`OxaPay flow pending setup for order ${orderId}`);
});

app.listen(PORT, () => console.log(`🚀 Store running at http://localhost:${PORT}`));
