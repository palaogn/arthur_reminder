var express = require("express");
var request = require("request");
var bodyParser = require("body-parser");
var mongoose = require("mongoose");
var cron = require('node-schedule');

var db = mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/scheduledb");
var Schedule = require("./model/schedule.js");


var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 5000));


// Server index page
app.get("/", function (req, res) {
  res.send("Arthur is alive!");
});


// Facebook Webhook
// Used for verification
app.get("/webhook", function (req, res) {
  if (req.query["hub.verify_token"] === "mango") {
    console.log("Verified webhook");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    console.error("Verification failed. The tokens do not match.");
    res.sendStatus(403);
  }
});

// All callbacks for Messenger will be POST-ed here
app.post("/webhook", function (req, res) {
  // Make sure this is a page subscription
  if (req.body.object == "page") {
    // Iterate over each entry
    // There may be multiple entries if batched
    req.body.entry.forEach(function(entry) {
      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.postback) {
          processPostback(event);
        } else if (event.message) {
          processMessage(event);
        }
      });
    });

    res.sendStatus(200);
  }
});

function processPostback(event) {
  var senderId = event.sender.id;
  var payload = event.postback.payload;

  if (payload == "Greeting") {
    // Get user's first name from the User Profile API
    // and include it in the greeting
    request({
      url: "https://graph.facebook.com/v2.6/" + senderId,
      qs: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        fields: "first_name"
      },
      method: "GET"
    }, function(error, response, body) {
      var greeting = "";
      if (error) {
        console.log("Error getting user's name: " +  error);
      } else {
        var bodyObj = JSON.parse(body);
        name = bodyObj.first_name;
        greeting = "Hi " + name + ". " + "My name is Arthur and I can send you a reminder every day.";
      }
      sendMessage(senderId, {text: greeting});
      confirmChangeTime(senderId);
    });
  }
  else if (payload == "ChangeTimeYES") {

	  message = {
		"text":"Pick a time:",
		"quick_replies":[
		  {
			"content_type":"text",
			"title":"3:00",
			"payload":"TimeThree"
		  },
		  {
			"content_type":"text",
			"title":"6:00",
			"payload":"TimeSix"
		  },
		  {
			"content_type":"text",
			"title":"9:00",
			"payload":"TimeNine"
		  },
		  {
			"content_type":"text",
			"title":"12:00",
			"payload":"TimeTwelve"
		  }
		]
	}

    sendMessage(senderId, message);
  }
  else if (payload == "ChangeTimeNO"){
    sendMessage(senderId, {text: "Alright, then we will not change the time"});
  }
}

function processMessage(event) {
  if (!event.message.is_echo) {
    var message = event.message;
    var senderId = event.sender.id;

    console.log("Received message from senderId: " + senderId);
    console.log("Message is: " + JSON.stringify(message));

    // You may get a text or attachment but not both
    if (message.text) {
      var formattedMsg = message.text.toLowerCase().trim();

      //checks if these words are in the message and replies.
      switch (formattedMsg) {
        case String(formattedMsg.match(/.*hi.*/)):
        case String(formattedMsg.match(/.*hello.*/)):
        case String(formattedMsg.match(/.*good morning.*/)):
          sendMessage(senderId, {text: "Hey there"});
          break;
        case String(formattedMsg.match(/.*change.*/)):
        case String(formattedMsg.match(/.*schedule.*/)):
        case String(formattedMsg.match(/.*date.*/)):
          confirmChangeTime(senderId);
          break;

		case "3:00":
		case "6:00":
		case "9:00":
		case "12:00":
			updateDatabase(senderId, formattedMsg);
			triggerMessagejob(senderId, formattedMsg);
		break;

        default:
          sendMessage(senderId, {text: "Sorry, did not get that, can you try again"});
      }
    } else if (message.attachments) {
      sendMessage(senderId, {text: "Sorry, I don't understand your request."});
    }
  }
}

// sends message to user
function sendMessage(recipientId, message) {
  request({
    url: "https://graph.facebook.com/v2.6/me/messages",
    qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
    method: "POST",
    json: {
      recipient: {id: recipientId},
      message: message,
    }
  }, function(error, response, body) {
    if (error) {
      console.log("Error sending message: " + response.error);
    }
  });
}

function triggerMessagejob(senderId, formattedMsg) {
	
	var time = formattedMsg.split(":");
	var date = time[1] + ' ' + time[0] + ' * * *'
	
	sendMessage(senderId, {text: "You scheduled this time: " + date});
	
	cron.cancelJob(senderId);
	
	//var j = cron.scheduleJob(senderId, date, function(){
	var j = cron.scheduleJob(senderId, '*/5 * * * *', function(){	
		sendMessage(senderId, {text: "The answer to life, the universe, and everything!"});
		console.log('The answer to life, the universe, and everything!');
	});
}

function updateDatabase(senderId, formattedMsg) {
  //is this a real time
  //does id exist, then change time
  //add id and time to db

  var query = {user_id: senderId};

  var schedule = {
	user_id: senderId,
    time: formattedMsg,
  };

  // Creates a new document if no documents is found
  var options = {upsert: true};

  Schedule.findOneAndUpdate(query, schedule, options, function(err, sch){
	  if (err) {
        console.log("Database error: " + err);
      } else {
		sendMessage(senderId, {text: "Alright, then we will send you reminder at " + formattedMsg + " time."});
	  }
  });
}

function confirmChangeTime(senderId) {
  var message = {
    "attachment":{
      "type":"template",
      "payload":{
        "template_type":"button",
        "text":"Do you want schedule the time?",
        "buttons":[
          {
            "type":"postback",
            "title":"Yes",
            "payload":"ChangeTimeYES"
          },
          {
            "type":"postback",
            "title":"No",
            "payload":"ChangeTimeNO"
          }
        ]
      }
    }
  }
  sendMessage(senderId, message);
}
