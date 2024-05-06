const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
const cors = require('cors')
app.use(express.json());

const secret = 'mysecret';

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));
  
  


let pool = null;

const initMySQL = async () => {
    try {
        pool = await mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: 'root',
            port: '3306',
            database: 'friendtest'
        })
        return pool;
    } catch (error) {
        console.error('Error initializing MySQL:', error);
        throw error;
    }
}

const ensureMySQLInitialized = async (req, res, next) => {
    try {
        if (!pool) {
            await initMySQL();
        }
        next();
    } catch (error) {
        console.error('Error initializing MySQL:', error)
        res.status(500).json({ error: 'Internal server error' })
    }
}

app.use(ensureMySQLInitialized);

const port = process.env.PORT || 8080;
app.listen(port, async () => {
    await initMySQL();
    console.log(`Server is running on port :${port}`);
});

process.on('exit', () => {
    if (pool) {
        pool.end();
        console.log('MySQL connection closed')
    }
})

app.post("/register", async (req, res) => {
    const { username, email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE username = ?",username)
    if(rows.length){
        return res.status(400).send({message:"Email is already registered"})
    }
    const hash = await bcrypt.hash(password,10);
    const userData = {username,email,password:hash};
    try{
        const result = await pool.query("INSERT INTO users SET ?", userData);
    }catch(error){
        console.error(error);
        res.status(400).json({
            message: "INSERT FAIL",
            error,
        })
    }
    res.status(201).send({ message: "User registered successfully" });
})


app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    const [result] = await pool.query("SELECT * from users WHERE username = ?", username);
    const user = result[0];    
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).send({ message: "Invalid email or password" });
    }
    const token = jwt.sign({ email: user.username }, secret, { expiresIn: "1h" });
    res.cookie
    res.send({ message: "Login successful",token});
    console.log({message:"Login successful",token})

 })

 const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
  
    if (token == null) return res.sendStatus(401); // if there isn't any token
  
    try {
      const user = jwt.verify(token, secret);
      req.user = user;
      console.log("user", user);
      next();
    } catch (error) {
      return res.sendStatus(403);
    }
  };


  app.post("/create_post", authenticateToken, async (req, res) => {
    const username = req.user.email; // Get the email from the JWT payload
    try {
        // Fetch the user from the database based on the email

        const [userRows] = await pool.query("SELECT user_id FROM users WHERE username = ?", [username]);
        
        // Check if the user exists
        if (userRows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        // Extract the user_id from the fetched user data
        const user_id = userRows[0].user_id;

        // Destructure other fields from the request body
        const { title, description, max_participants, category, eventStart } = req.body;
        
        // Check if all required fields are provided
        if (!title || !max_participants || !category || !eventStart) {
            console.log('All fields are required')
            return res.status(400).json({ message: "All fields are required" });
        }

        // Insert the post data into the database
        const result = await pool.query("INSERT INTO posts (user_id, title, description, max_participants, category, event_start) VALUES (?, ?, ?, ?, ?, ?)", [user_id, title, description, max_participants, category, eventStart]);

        // Check if the post was inserted successfully
        if (result.affectedRows === 1) {
            return res.status(201).json({ message: "Post created successfully" });
        } else {
            return res.status(500).json({ message: "Failed to create post" });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

app.get("/posts", async (req, res) => {
    try {
        // Query the database to get all posts
        const [rows] = await pool.query("SELECT * FROM posts");

        // Check if any posts were found
        if (rows.length === 0) {
            return res.status(404).json({ message: "No posts found" });
        }

        // Send the retrieved posts as a response
        console.log(rows)
        res.status(200).json(rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

app.post('/participants', authenticateToken, async (req, res) => {
    try {
        const username = req.user.email; // Get the email from the JWT payload

        const [userRows] = await pool.query("SELECT user_id FROM users WHERE username = ?", [username]);

        const user_id = userRows[0].user_id; // Extract user_id from the database query result

        const { post_id } = req.body; // ปรับให้ใช้ post_id ตรงนี้

        // Check the current number of participants for the post
        const [participantRows] = await pool.query("SELECT COUNT(*) AS count FROM participants WHERE post_id = ?", [post_id]);
        const currentParticipantsCount = participantRows[0].count;

        // Fetch the max participants allowed for the post from the database
        const [postRows] = await pool.query("SELECT max_participants FROM posts WHERE post_id = ?", [post_id]);
        const maxParticipants = postRows[0].max_participants;

        // Check if the current number of participants has reached the max limit
        if (currentParticipantsCount >= maxParticipants) {
            return res.status(400).json({ message: "Maximum participants limit reached for this post" });
        }

        // Insert the participant into the database
        const result = await pool.query('INSERT INTO participants (post_id, user_id, joined_at) VALUES (?, ?, NOW())', [post_id, user_id]);

        res.status(200).json({ message: 'Participant added successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get("/user_activities", authenticateToken, async (req, res) => {
    try {
        const username = req.user.email; // Get the email from the JWT payload

        // Fetch user ID based on the email
        const [userRows] = await pool.query("SELECT user_id FROM users WHERE username = ?", [username]);
        const user_id = userRows[0].user_id;

        // Query the database to get activities joined by the user
        const [activityRows] = await pool.query("SELECT * FROM participants WHERE user_id = ?", [user_id]);

        // Send the retrieved activities as a response
        console.log(activityRows);
        res.status(200).json(activityRows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get("/user_posts", authenticateToken, async (req, res) => {
    try {
        const username = req.user.email; // Get the email from the JWT payload

        // Fetch user ID based on the email
        const [userRows] = await pool.query("SELECT user_id FROM users WHERE username = ?", [username]);
        const user_id = userRows[0].user_id;

        // Query the database to get posts created by the user
        const [postRows] = await pool.query("SELECT * FROM posts WHERE user_id = ?", [user_id]);

        // Send the retrieved posts as a response
        console.log(postRows);
        res.status(200).json(postRows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


  


