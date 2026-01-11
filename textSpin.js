// textSpin.js
const phrases = [
  
  "slm cv",
  "wax fiha hada message ",
];

function generateMessage() {
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  const emojis = ["🙂", "✨", "👋", "😃", "💫"];
  const emoji = Math.random() < 0.5 ? " " + emojis[Math.floor(Math.random() * emojis.length)] : "";
  return phrase + emoji;
}

module.exports = { generateMessage };
