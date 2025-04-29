require('dotenv').config(); // Load environment variables from .env file
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Parser } = require("json2csv");
const csvParser = require("csv-parser");
const https = require("https");

console.log("SHOPIFY_API_KEY:", process.env.SHOPIFY_API_KEY);
console.log("SHOPIFY_ACCESS_TOKEN:", process.env.SHOPIFY_ACCESS_TOKEN);
console.log("SHOPIFY_STORE_DOMAIN:", process.env.SHOPIFY_STORE_DOMAIN);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// --- CSV Generator ---
app.post("/generate-csv", (req, res) => {
  try {
    const data = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).send("Invalid data");
    }

    const fields = Object.keys(data[0]);
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    res.header("Content-Type", "text/csv");
    res.attachment("order_history.csv");
    res.send(csv);
  } catch (error) {
    console.error("CSV generation error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// --- Root Route ---
app.get("/", (req, res) => {
  res.send("✅ CSV generator + live Shopify order data is running!");
});

// --- Webhook to handle order creation ---
app.post("/process-csv-orders", async (req, res) => {
  try {
    const order = req.body;
    const note = order?.note || "";
    const csvUrlMatch = note.match(/https:\/\/[^\s]+\.csv/);

    // CASE: no CSV in the note — skip, let the order behave normally
    if (!csvUrlMatch) {
      console.log(
        `ℹ️ No CSV URL found in note for order ${order?.name || order?.id}`,
      );
      return res.status(200).send("No CSV file in note — skipping");
    }

    const csvUrl = csvUrlMatch[0];
    const rows = [];

    const fetchCsv = () =>
      new Promise((resolve, reject) => {
        https.get(csvUrl, (response) => {
          response
            .pipe(csvParser())
            .on("data", (row) => rows.push(row))
            .on("end", resolve)
            .on("error", reject);
        });
      });

    await fetchCsv();

    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    const results = [];

    for (const row of rows) {
      const fullName = row.name || "Gift Recipient";
      const [firstName, ...rest] = fullName.split(" ");
      const lastName = rest.join(" ") || "Recipient";

      const newOrder = {
        order: {
          line_items:
            order.line_items?.map((item) => ({
              variant_id: item.variant_id,
              quantity: item.quantity || 1,
            })) || [],
          customer: {
            first_name: firstName,
            last_name: lastName,
            email: row.email || "placeholder@example.com",
          },
          shipping_address: {
            name: fullName,
            address1: row.address1 || "",
            address2: row.address2 || "",
            city: row.city || "",
            province: row.state || "",
            zip: row.zip || "",
            country: "United States",
          },
          financial_status: "paid",
          tags: `Created from CSV of order ${order?.name || order?.id}`,
        },
      };

      try {
        const createRes = await axios.post(
          `https://${storeDomain}/admin/api/2025-04/orders.json`,
          newOrder,
          {
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
          },
        );

        results.push({
          success: true,
          orderName: createRes.data.order.name,
          address: row.address1,
        });
      } catch (err) {
        console.error(
          "❌ Order creation failed for row:",
          row,
          err.response?.data || err.message,
        );
        results.push({ success: false, error: err.message, row });
      }
    }

    // After child orders are created, cancel the parent
    try {
      await axios.post(
        `https://${storeDomain}/admin/api/2025-04/orders/${order.id}/cancel.json`,
        {},
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        },
      );
      console.log(
        `✅ Parent order ${order.id} canceled after creating ${results.length} child orders.`,
      );
    } catch (cancelErr) {
      console.error(
        `❌ Failed to cancel parent order ${order.id}:`,
        cancelErr.response?.data || cancelErr.message,
      );
    }

    res.json({ message: "Orders processed and parent canceled", results });
  } catch (err) {
    console.error(
      "💥 Error in /process-csv-orders:",
      err.response?.data || err.message,
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

// health 
app.get('/health', (req, res) => {

  res.status(200).send('OK');

});
// Add error handling

process.on('SIGTERM', () => {

  console.log('Received SIGTERM signal, keeping process alive');

});



process.on('SIGINT', () => {

  console.log('Received SIGINT signal, keeping process alive');

});



// Start server
app.listen(port, '0.0.0.0', () => {

  console.log(`Server running on port ${port}`);

});



