<!DOCTYPE html>
<html lang="bg">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Register - Crypto Store</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .register-container {
            background: white;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        
        .logo {
            font-size: 4em;
            margin-bottom: 20px;
        }
        
        .register-header h1 {
            color: #333;
            margin-bottom: 10px;
        }
        
        .register-header p {
            color: #6c757d;
            margin-bottom: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
            text-align: left;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #495057;
        }
        
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        
        .form-group input:focus {
            outline: none;
            border-color: #28a745;
            box-shadow: 0 0 0 3px rgba(40, 167, 69, 0.1);
        }
        
        .register-btn {
            width: 100%;
            background: linear-gradient(45deg, #28a745, #20c997);
            color: white;
            padding: 15px;
            border: none;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            margin-bottom: 20px;
        }
        
        .register-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }
        
        .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .links {
            display: flex;
            justify-content: space-between;
            margin-top: 20px;
        }
        
        .links a {
            color: #28a745;
            text-decoration: none;
            font-weight: 500;
        }
        
        .links a:hover {
            text-decoration: underline;
        }
        
        .password-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 12px;
            border-radius: 8px;
            margin-top: 15px;
            text-align: left;
            font-size: 14px;
        }
        
        .simple-captcha {
            background: #f8f9fa;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .captcha-question {
            font-size: 18px;
            font-weight: bold;
            color: #495057;
            margin-bottom: 10px;
        }
        
        .captcha-input {
            width: 100px;
            text-align: center;
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <div class="register-container">
        <div class="logo">📝</div>
        <div class="register-header">
            <h1>Create Account</h1>
            <p>Join our crypto store</p>
        </div>
        
        <% if (typeof error !== 'undefined' && error) { %>
            <div class="error-message"><%= error %></div>
        <% } %>
        
        <form method="POST" action="/register" onsubmit="return validateForm()">
            <div class="form-group">
                <label for="username">👤 Username:</label>
                <input type="text" id="username" name="username" required minlength="3">
            </div>
            
            <div class="form-group">
                <label for="password">🔑 Password:</label>
                <input type="password" id="password" name="password" required minlength="6">
            </div>
            
            <div class="form-group">
                <label for="confirmPassword">🔑 Confirm Password:</label>
                <input type="password" id="confirmPassword" required minlength="6">
            </div>
            
            <div class="simple-captcha">
                <div class="captcha-question" id="captchaQuestion">5 + 3 = ?</div>
                <input type="number" class="captcha-input" id="captchaAnswer" required>
            </div>
            
            <button type="submit" class="register-btn">
                🚀 Create Account
            </button>
        </form>
        
        <div class="links">
            <a href="/login">Already have account?</a>
            <a href="/">← Back to Store</a>
        </div>
        
        <div class="password-info">
            <strong>Requirements:</strong><br>
            • Username: min 3 characters<br>
            • Password: min 6 characters<br>
            • No email required!
        </div>
    </div>
    
    <script>
        // Generate random captcha on page load
        function generateCaptcha() {
            const num1 = Math.floor(Math.random() * 10) + 1;
            const num2 = Math.floor(Math.random() * 10) + 1;
            const answer = num1 + num2;
            
            document.getElementById('captchaQuestion').textContent = `${num1} + ${num2} = ?`;
            window.captchaAnswer = answer;
        }
        
        function validateForm() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const captchaInput = parseInt(document.getElementById('captchaAnswer').value);
            
            if (username.length < 3) {
                alert('Username must be at least 3 characters');
                return false;
            }
            
            if (password.length < 6) {
                alert('Password must be at least 6 characters');
                return false;
            }
            
            if (password !== confirmPassword) {
                alert('Passwords do not match');
                return false;
            }
            
            if (captchaInput !== window.captchaAnswer) {
                alert('Incorrect captcha answer');
                generateCaptcha(); // Generate new captcha
                document.getElementById('captchaAnswer').value = '';
                return false;
            }
            
            return true;
        }
        
        // Generate captcha when page loads
        generateCaptcha();
    </script>
</body>
</html>