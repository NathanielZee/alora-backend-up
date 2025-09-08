const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const liteApi = require("liteapi-node-sdk");
const cors = require("cors");
require("dotenv").config();

app.use(
  cors({
    origin: "*", // Allow all origins for mobile app requests
  })
);

const prod_apiKey = process.env.PROD_API_KEY;
const sandbox_apiKey = process.env.SAND_API_KEY;

app.use(bodyParser.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "🏨 Alora Hotel Booking API", 
    version: "1.0.0",
    endpoints: ["/search-hotels", "/search-rates", "/prebook", "/book"]
  });
});

// --- Search Hotels ---
app.get("/search-hotels", async (req, res) => {
  console.log("🔍 Search hotels endpoint hit");
  console.log("Query params:", req.query);
  
  const { checkin, checkout, adults, city, countryCode, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  console.log(`Using ${environment} environment`);
  
  if (!apiKey) {
    console.error("❌ API key not found for environment:", environment);
    return res.status(500).json({ error: "API key not configured" });
  }

  const sdk = liteApi(apiKey);

  try {
    // Step 1: Get hotels
    console.log("📡 Calling sdk.getHotels...");
    const hotelsResponse = await sdk.getHotels(countryCode, city, 0, 10);
    
    console.log("🏨 Hotels response:", JSON.stringify(hotelsResponse, null, 2));
    
    // Handle different response structures safely
    const hotelsData = hotelsResponse?.data || hotelsResponse;
    
    if (!hotelsData || !Array.isArray(hotelsData)) {
      console.error("❌ No valid hotels data received:", hotelsData);
      return res.status(404).json({ error: "No hotels found for this location" });
    }

    if (hotelsData.length === 0) {
      console.log("⚠️ Empty hotels array");
      return res.json({ rates: [] });
    }

    const hotelIds = hotelsData.map((hotel) => hotel.id);
    console.log("🔑 Hotel IDs:", hotelIds);

    // Step 2: Get rates
    console.log("💰 Calling sdk.getFullRates...");
    const ratesResponse = await sdk.getFullRates({
      hotelIds,
      occupancies: [{ adults: parseInt(adults, 10) }],
      currency: "USD",
      guestNationality: "US",
      checkin,
      checkout,
    });

    console.log("💰 Rates response:", JSON.stringify(ratesResponse, null, 2));
    
    const ratesData = ratesResponse?.data || ratesResponse;
    
    if (!ratesData || !Array.isArray(ratesData)) {
      console.error("❌ No valid rates data received:", ratesData);
      return res.json({ rates: [] });
    }

    // Step 3: Merge hotel info with rates
    ratesData.forEach((rate) => {
      rate.hotel = hotelsData.find((hotel) => hotel.id === rate.hotelId);
    });

    console.log("✅ Returning", ratesData.length, "hotel rates");
    res.json({ rates: ratesData });
    
  } catch (error) {
    console.error("❌ Error searching for hotels:", error);
    console.error("Error details:", error.message, error.stack);
    res.status(500).json({ 
      error: "Failed to search hotels",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// --- Search Rates (Single Hotel) ---
app.get("/search-rates", async (req, res) => {
  console.log("🔍 Search rates endpoint hit");
  console.log("Query params:", req.query);
  
  const { checkin, checkout, adults, hotelId, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  if (!apiKey) {
    console.error("❌ API key not found for environment:", environment);
    return res.status(500).json({ error: "API key not configured" });
  }

  const sdk = liteApi(apiKey);

  try {
    // Step 1: Get rates for specific hotel
    console.log("💰 Getting rates for hotel:", hotelId);
    const ratesResponse = await sdk.getFullRates({
      hotelIds: [hotelId],
      occupancies: [{ adults: parseInt(adults, 10) }],
      currency: "USD",
      guestNationality: "US",
      checkin,
      checkout,
    });

    const ratesData = ratesResponse?.data || ratesResponse;
    
    if (!ratesData || !Array.isArray(ratesData) || ratesData.length === 0) {
      console.log("⚠️ No rates found for hotel:", hotelId);
      return res.status(404).json({ error: "No availability found" });
    }

    // Step 2: Get hotel details
    console.log("🏨 Getting hotel details for:", hotelId);
    const hotelResponse = await sdk.getHotelDetails(hotelId);
    const hotelInfo = hotelResponse?.data || hotelResponse;

    // Step 3: Process rates
    const rateInfo = ratesData.map((hotel) =>
      hotel.roomTypes?.flatMap((roomType) => {
        const boardTypes = ["RO", "BI"];
        return boardTypes
          .map((boardType) => {
            const filteredRates = roomType.rates?.filter((rate) => rate.boardType === boardType) || [];
            
            const sortedRates = filteredRates.sort((a, b) => {
              if (a.cancellationPolicies?.refundableTag === "RFN" && b.cancellationPolicies?.refundableTag !== "RFN") {
                return -1;
              } else if (b.cancellationPolicies?.refundableTag === "RFN" && a.cancellationPolicies?.refundableTag !== "RFN") {
                return 1;
              }
              return 0;
            });
            
            if (sortedRates.length > 0) {
              const rate = sortedRates[0];
              return {
                rateName: rate.name,
                offerId: roomType.offerId,
                board: rate.boardName,
                refundableTag: rate.cancellationPolicies?.refundableTag,
                retailRate: rate.retailRate?.total?.[0]?.amount,
                originalRate: rate.retailRate?.suggestedSellingPrice?.[0]?.amount,
              };
            }
            return null;
          })
          .filter((rate) => rate !== null);
      }) || []
    );

    console.log("✅ Returning hotel info and rates");
    res.json({ hotelInfo, rateInfo });
    
  } catch (error) {
    console.error("❌ Error fetching rates:", error);
    res.status(500).json({ error: "No availability found" });
  }
});

// --- Prebook ---
app.post("/prebook", async (req, res) => {
  console.log("📝 Prebook endpoint hit");
  console.log("Body:", req.body);
  
  const { rateId, environment, voucherCode } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  if (!apiKey) {
    console.error("❌ API key not found for environment:", environment);
    return res.status(500).json({ error: "API key not configured" });
  }

  const sdk = liteApi(apiKey);
  const bodyData = { offerId: rateId, usePaymentSdk: true };
  
  if (voucherCode) {
    bodyData.voucherCode = voucherCode;
  }

  try {
    console.log("📋 Calling sdk.preBook with:", bodyData);
    const response = await sdk.preBook(bodyData);
    console.log("✅ Prebook successful:", response);
    res.json({ success: response });
  } catch (error) {
    console.error("❌ Prebook error:", error);
    res.status(500).json({ 
      error: "Prebook failed",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// --- Book ---
app.get("/book", async (req, res) => {
  console.log("✈️ Book endpoint hit");
  console.log("Query params:", req.query);
  
  const { prebookId, guestFirstName, guestLastName, guestEmail, transactionId, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  
  if (!apiKey) {
    console.error("❌ API key not found for environment:", environment);
    return res.status(500).json({ error: "API key not configured" });
  }

  const sdk = liteApi(apiKey);

  const bodyData = {
    holder: { firstName: guestFirstName, lastName: guestLastName, email: guestEmail },
    payment: { method: "TRANSACTION_ID", transactionId },
    prebookId,
    guests: [
      { 
        occupancyNumber: 1, 
        firstName: guestFirstName, 
        lastName: guestLastName, 
        email: guestEmail,
        remarks: ""
      }
    ],
  };

  try {
    console.log("🎯 Calling sdk.book with:", bodyData);
    const bookingData = await sdk.book(bodyData);
    
    if (!bookingData || bookingData.error) {
      throw new Error("Booking failed: " + (bookingData?.error?.message || "Unknown error"));
    }

    console.log("✅ Booking successful:", bookingData);
    
    // Return JSON for mobile app (instead of HTML)
    res.json({ 
      success: true,
      booking: bookingData,
      message: "Booking confirmed successfully!"
    });
    
  } catch (error) {
    console.error("❌ Booking error:", error);
    res.status(500).json({ 
      success: false,
      error: "Booking failed",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// --- Start Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Alora Hotel API server running on port ${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Sandbox API Key: ${sandbox_apiKey ? '✅ Set' : '❌ Missing'}`);
  console.log(`🔑 Production API Key: ${prod_apiKey ? '✅ Set' : '❌ Missing'}`);
});