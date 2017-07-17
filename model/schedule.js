var mongoose = require("mongoose");
var Schema = mongoose.Schema;

var ScheduleSchema = new Schema({
  user_id: {type: String},
  time: {type: String},
});

module.exports = mongoose.model("Schedule", ScheduleSchema);