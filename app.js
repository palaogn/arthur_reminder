var express = require("express");
var request = require("request");
var bodyParser = require("body-parser");
var mongoose = require("mongoose");
var cron = require('node-schedule');

var db = mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/scheduledb");
var Schedule = require("./model/schedule.js");

var scheduledTime = null;

var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.listen((process.env.PORT || 5000), function () {
  console.log('Arthur is listening on port 5000');
  triggerAllJobsFromDb();
});

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
  else if (payload == "ChangeTimeYes") {
    sendMessage(senderId, {text: "Enter the time"});
    sendMessage(senderId, {text: "psss please use the format HH:MM so I can understand you"});
  }
  else if (payload == "ChangeTimeNo"){
    sendMessage(senderId, {text: "Alright, then we will not change the time. If you are in trouble try writing SOS"});
  }
  else if (payload == "DeleteTimeYes"){
    console.log("You choose yes to delete reminder");
    deleteDbReminder(senderId);
  }
  else if (payload == "DeleteTimeNo"){
    sendMessage(senderId, {text: "Alright, then we will not delete your reminders. If you are in trouble try writing SOS"});
  }
  else if (payload == "ConfirmTimeYes") {
    scheduleTimeAccordingToTimezone(senderId);
  }
  else if (payload == "ConfirmTimeNo"){
    sendMessage(senderId, {text: "Alright, my mistake. :) If you are in trouble try writing SOS"});
  }
}

//The scheduledTime is a string so we have to split it and then change the number.
//Ther server is on timezone 0 so we subtract the timezone number to get the correct time for the server.
//In the end we return it as a string on the righ tformat for node-schedule
function changeToServerTimezone(scheduledTime, userTimezone) {
  var time = scheduledTime.split(":");
  var date = time[1] + ' ' + (parseInt(time[0])-userTimezone) + ' * * *';
  return date;
}

function scheduleTimeAccordingToTimezone(senderId) {
  //First we get the user timezone
	request({
      url: "https://graph.facebook.com/v2.6/" + senderId,
      qs: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        fields: "timezone"
      },
      method: "GET"
    }, function(error, response, body, result) {
      if (error) {
        console.log("Error getting user's timezone: " +  error);
      } else {
        var bodyObj = JSON.parse(body);
        result = bodyObj.timezone;
		    var timezone = result;
		    console.log("User's timezone: " + timezone);
        //We have to change the saved time to server timezone which is on timezone zero
        var serverScheduledTime = changeToServerTimezone(scheduledTime, timezone);
        updateDatabase(senderId, serverScheduledTime);
      	triggerMessagejob(senderId, serverScheduledTime);
      }
    });
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

      console.log("The message sent: " + formattedMsg);
      //checks if these words are in the message and replies.
      switch (formattedMsg) {
        case String(formattedMsg.match(/.*hi.*/)):
        case String(formattedMsg.match(/.*hello.*/)):
        case String(formattedMsg.match(/.*good morning.*/)):
          sendMessage(senderId, {text: "Hey there"});
          break;
        case String(formattedMsg.match(/.*change.*/)):
        case String(formattedMsg.match(/.*schedule.*/)):
        case String(formattedMsg.match(/.*reschedule.*/)):
        case String(formattedMsg.match(/.*date.*/)):
          confirmChangeTime(senderId);
          break;
        case String(formattedMsg.match(/.*delete.*/)):
        case String(formattedMsg.match(/.*stop.*/)):
        case String(formattedMsg.match(/.*revert.*/)):
        case String(formattedMsg.match(/.*quit.*/)):
        case String(formattedMsg.match(/.*exit.*/)):
          confirmDeleteReminder(senderId);
          break;
        case String(formattedMsg.match(/.*help.*/)):
        case String(formattedMsg.match(/.*sos.*/)):
          sendMessage(senderId, {text: "Hey there I see you are in trouble. Ask me to reschedule if you want to reschedule your reminders and to delete your reminder if you want to delete them."});
          break;
        case String(formattedMsg.match(/[0-9]:[0-5][0-9]|0[0-9]:[0-5][0-9]|1[0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]/)):
			scheduledTime = formattedMsg;
			confirmCorrectTime(senderId, formattedMsg);
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

function getQuote() {
	
	request("https://quotesondesign.com/wp-json/posts?filter[orderby]=rand&filter[posts_per_page]", function (error, response, body) {
		console.log("error:", error);
		console.log("statusCode:", response && response.statusCode);
		console.log("body:", body);
		console.log(body[0]);
		var bodyObj = JSON.parse(body[0]);
		var title = bodyObj.title;
		var content = bodyObj.content;
		console.log("Author: " + bodyObj.title);
		console.log("Quote: " + bodyObj.content);
	});
	
	
	/*
	request({
		url: "https://quotesondesign.com/wp-json/posts?filter[orderby]=rand&filter[posts_per_page]",
		method: "GET",
	}, function(error, response, body) {
		if (error) {
			console.log("Error sending message: " + response.error);
		}
		else {
			console.log(body);
			console.log(response);
			var bodyObj = JSON.parse(body);
			var title = bodyObj.title;
			var content = bodyObj.content;
			console.log("Author: " + title);
			console.log("Quote: " + content);
		}
	}); */
}

function triggerMessagejob(senderId, formattedMsg) {
	cron.cancelJob(senderId);
	
	var quote = "The answer to life, the universe, and everything!";
	quote = getQuote();

	var j = cron.scheduleJob(senderId, formattedMsg, function(){
		sendMessage(senderId, {text: quote});
	});
}

function updateDatabase(senderId, formattedMsg) {

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
		sendMessage(senderId, {text: "Alright, then I will send you reminder at that time."});
	  }
  });
}

function deleteDbReminder(senderId) {
var query = {user_id: senderId};
console.log("You just called the funciton deleteDbReminder");
  Schedule.remove(query, function(err) {
    if(err) {
      console.log("Database error: " + err);
    } else {
      sendMessage(senderId, {text: "I will not send you reminders anymore. If you want to schedule a new reminder then just talk to me."})
      sendMessage(senderId, {text: "I also have a good shoulder to cry on if you need someone to talk to!"})
    }
  });

}

function triggerAllJobsFromDb() {

  var array = [];

  Schedule.find({}, function(err, doc){
	  if (err) {
        console.log("Database error: " + err);
      } else {
		array = doc;
		for (var i = 0; i < array.length; i++) {
			triggerMessagejob(array[i].user_id, array[i].time);
		}
		console.log("Triggered " + array.length + " jobs from the database...");
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
            "payload":"ChangeTimeYes"
          },
          {
            "type":"postback",
            "title":"No",
            "payload":"ChangeTimeNo"
          }
        ]
      }
    }
  }
  sendMessage(senderId, message);
}

function confirmDeleteReminder(senderId) {
  var message = {
    "attachment":{
      "type":"template",
      "payload":{
        "template_type":"button",
        "text":"Do you want me to stop sending you reminders?",
        "buttons":[
          {
            "type":"postback",
            "title":"Yes",
            "payload":"DeleteTimeYes"
          },
          {
            "type":"postback",
            "title":"No",
            "payload":"DeleteTimeNo"
          }
        ]
      }
    }
  }
  sendMessage(senderId, message);
}

function confirmCorrectTime(senderId, formattedMsg) {
	var message = {
		"attachment":{
		  "type":"template",
		  "payload":{
			"template_type":"button",
			"text":"So, you want me to send you reminder at " + formattedMsg + "?",
			"buttons":[
			  {
				"type":"postback",
				"title":"Yes",
				"payload":"ConfirmTimeYes"
			  },
			  {
				"type":"postback",
				"title":"No",
				"payload":"ConfirmTimeNo"
			  }
			]
		  }
		}
	}
	sendMessage(senderId, message);
}
