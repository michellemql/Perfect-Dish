//jshint esversion:6
require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const GridFsStorage = require('multer-gridfs-storage');
const Grid = require('gridfs-stream');
const methodOverride = require('method-override');

const md5 = require("md5");
const session = require('express-session');
const passport = require("passport");
const LocalStrategy = require('passport-local').Strategy;
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const _ = require("lodash");

const app = express();

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(methodOverride('_method'));

app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());


// MongoDB URI ("mongodb://localhost:27017/blogDB")
const conn = mongoose.createConnection("mongodb+srv://admin-mengqi:Test-123@cluster0-8rfhr.mongodb.net/blogDB?retryWrites=true&w=majority", {
  useNewUrlParser: true
});
mongoose.set("useCreateIndex", true);


// MongoDB Schema
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  googleId: String,
  facebookId: String,
  recipes: [{
    title: String,
    serving: Number,
    prepareTimeHour: Number,
    prepareTimeMin: Number,
    cookTimeHour: Number,
    cookTimeMin: Number,
    totalTimeHour: Number,
    totalTimeMin: Number,
    introduction: String,
    ingredients: Array,
    instructions: Array,
    image: Map
  }]
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = conn.model("User", userSchema);


// Passport Strategy
passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});
passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

// Passport Google OAuth
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://desolate-oasis-09702.herokuapp.com/auth/google/perfectdish",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
  },
  function(accessToken, refreshToken, profile, cb) {
    User.findOrCreate({
      googleId: profile.id,
      username: profile.name.givenName != null ? profile.name.givenName : profile.displayName
    }, function(err, user) {
      return cb(err, user);
    });
  }
));

// Passport Facebook OAuth
passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    callbackURL: "https://desolate-oasis-09702.herokuapp.com/auth/facebook/perfectdish"
  },
  function(accessToken, refreshToken, profile, cb) {
    User.findOrCreate({
      facebookId: profile.id,
      username: profile.name.givenName != null ? profile.name.givenName : profile.displayName
    }, function(err, user) {
      return cb(err, user);
    });
  }
));


// Init gfs
let gfs;

conn.once('open', function() {
  // Init stream
  gfs = Grid(conn.db, mongoose.mongo);
  gfs.collection('uploads');
});

// Create storage engine
var storage = new GridFsStorage({
  url: 'mongodb+srv://admin-mengqi:Test-123@cluster0-8rfhr.mongodb.net/blogDB?retryWrites=true&w=majority',
  useNewUrlParser: true,
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(16, (err, buf) => {
        if (err) {
          return reject(err);
        }
        const filename = buf.toString('hex') + path.extname(file.originalname);
        const fileInfo = {
          filename: filename,
          bucketName: 'uploads',
        };
        resolve(fileInfo);
      });
    });
  }
});
const upload = multer({
  storage
});


// @route GET /register
app.get("/register", function(req, res) {
  res.render("register");
});
// @route GET /login
app.get("/login", function(req, res) {
  res.render("login");
});
// @route GET /logout
app.get("/logout", function(req, res) {
  req.logout();
  res.redirect("/");
});


// @route GET /auth/google
// @desc Google OAuth
app.get("/auth/google",
  passport.authenticate("google", {
    scope: ["profile"]
  }));

app.get("/auth/google/perfectdish",
  passport.authenticate("google", {
    failureRedirect: "/login"
  }),
  function(req, res) {
    res.redirect("/");
  });


// @route GET /auth/facebook
// @desc Facebook OAuth
app.get('/auth/facebook',
  passport.authenticate('facebook'));

app.get('/auth/facebook/perfectdish',
  passport.authenticate('facebook', {
    failureRedirect: '/login'
  }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });


// @route GET /
// @desc Display all recipes
app.get("/", function(req, res) {
  User.find({}, function(err, users){
    if (err) {
      console.log(err);
    } else {
      gfs.files.find().toArray(function(err, files){
        res.render("home", {
          users: users
        });
      });
    }
  });
});


// @route POST /search
// @desc  Search recipes
app.post("/search", function(req, res) {
  const searchContent = _.upperFirst(req.body.searchContent);
  User.find({'recipes.title': {"$regex": searchContent}}, function(err, matchUsers) {
    if(err){
      console.log(err);
    } else {
      res.render("search", {
        users: matchUsers,
        matchRecipeTitle: searchContent
      });
    }
  });
});


// @route GET /compose
// @desc  Create a recipe
app.get("/compose", function(req, res) {
  if (req.isAuthenticated()) {
    res.render("compose");
  } else {
    res.redirect("/login");
  }
});


// @route POST /compose
// @desc  Uploads recipe
app.post("/compose", upload.single('file'), function(req, res) {
  User.findById(req.user.id, function(err, foundUser) {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        foundUser.recipes.push({
          title: req.body.recipeTitle,
          serving: req.body.servingNumber,
          prepareTimeHour: req.body.prepareTimeHour,
          prepareTimeMin: req.body.prepareTimeMin,
          cookTimeHour: req.body.cookTimeHour,
          cookTimeMin: req.body.cookTimeMin,
          totalTimeHour: req.body.totalTimeHour,
          totalTimeMin: req.body.totalTimeMin,
          introduction: req.body.introduction,
          ingredients: req.body.ingredients,
          instructions: req.body.instructions,
          image: req.file
        });

        foundUser.save(function(err) {
          if (!err) {
            res.redirect("/");
          }
        });
      }
    }
  });
});

// @route POST /search
// @desc  Search recipes
app.post("/search", function(req, res) {
  const searchContent = _.lowerCase(req.body.searchContent);
  User.find({recipes: {title: /searchContent/}}, function(err, matchUsers) {
    if(err){
      console.log(err);
    } else {
      console.log(matchUsers);
      // gfs.files.find().toArray(function(err, files){
      //   res.render("home", {
      //     users: matchUsers
      //   });
      // });
    }
  })
})


app.get("/profile", function(req, res) {
  if (req.isAuthenticated()) {
    res.render("profile", {user: req.user, currentUser: req.user});
  } else {
    res.redirect("/login");
  }
});

app.get("/user/:userId", function(req, res){
  const requestedUserId = req.params.userId;

  User.findOne({_id: requestedUserId}, function(err, foundUser){
    if(err){
      console.log(err);
    } else {
      if(foundUser){
        res.render("profile", {user: foundUser, currentUser: req.user});
      }
    }
  });

});

app.get("/delete/:userId/:recipeId", function(req, res){
  const requestedUserId = req.params.userId;
  const requestedRecipeId = req.params.recipeId;

  User.findOne({_id: requestedUserId}, function(err, foundUser){
    // var currentRecipe = user.recipes[requestedRecipeIndex];
    // console.log("current recipe is" + currentRecipe);
    // user.recipes.remove({_id: requestedRecipeId});
    if(err){
      console.log(err);
    } else {
      if(foundUser){
        foundUser.recipes.remove({_id: requestedRecipeId});
        foundUser.save(function(err) {
          if (!err) {
            res.redirect("/profile");
          }
        });
      }
    }
  });
});


// @route POST /register
// @desc  User register
app.post("/register", function(req, res) {
  User.register({
    username: req.body.username
  }, req.body.password, function(err, user) {
    if (err) {
      console.log(err);
      res.redirect("/register");
    } else {
      passport.authenticate("local")(req, res, function() {
        res.redirect("/");
      });
    }
  });
});


// @route POST /login
// @desc  User login
app.post("/login", function(req, res) {
  const user = new User({
    username: req.body.username,
    password: req.body.password
  });
  req.login(user, function(err) {
    if (err) {
      console.log(err);
    } else {
      passport.authenticate("local")(req, res, function() {
        res.redirect("/");
      });
    }
  });
});


// @route GET /posts/:postId/:filename
// @desc  Display single recipe
app.get("/posts/:userId/:recipeIndex/:filename", function(req, res) {
  const requestedUserId = req.params.userId;
  const requestedRecipeIndex = req.params.recipeIndex;

  User.findOne({
    _id: requestedUserId
  }, function(err, user) {
    var currentRecipe = user.recipes[requestedRecipeIndex];
    var imgName = currentRecipe.image.get('filename');
    res.render("post", {
      username: user.username,
      title: currentRecipe.title,
      serving: currentRecipe.serving,
      prepareTimeHour: currentRecipe.prepareTimeHour,
      prepareTimeMin: currentRecipe.prepareTimeMin,
      cookTimeHour: currentRecipe.cookTimeHour,
      cookTimeMin: currentRecipe.cookTimeMin,
      totalTimeHour: currentRecipe.totalTimeHour,
      totalTimeMin: currentRecipe.totalTimeMin,
      introduction: currentRecipe.introduction,
      ingredients: currentRecipe.ingredients,
      instructions: currentRecipe.instructions,
      image: imgName
    });
  });
});


// @route GET /image/:filename
// @desc  Get image
app.get("/image/:filename", function(req, res) {
  var requestedFilename = req.params.filename;

  gfs.files.findOne({
    filename: requestedFilename
  }, (err, file) => {
    var readstream = gfs.createReadStream(file.filename);
    readstream.pipe(res);
  });
});



const port = process.env.PORT || 3000;
app.listen(port, function() {
  console.log("Server started on port:" + port);
});
