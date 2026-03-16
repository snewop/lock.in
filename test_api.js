const fetch = require('node-fetch');

async function testBackend() {
  console.log("Testing simplified prompt format...");
  try {
    // Note: this will likely fail in a real environment without the API key, 
    // but we can check if it at least parses the prompt correctly or fails with "No prompt provided"
    const response = await fetch("http://localhost:3000/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello Claude" })
    });
    const data = await response.json();
    console.log("Status:", response.status);
    console.log("Data:", data);
  } catch (e) {
    console.log("Error (expected if local server not running):", e.message);
  }
}

// Just checking the file content again to be 100% sure about the regex/logic
// But I already did that.
