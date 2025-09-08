const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const liteApi = require("liteapi-node-sdk");
const cors = require("cors");
require("dotenv").config();

app.use(
  cors({
    origin: "*", // allow all origins for mobile app requests
  })
);

const prod_apiKey = process.env.PROD_API_KEY;
const sandbox_apiKey = process.env.SAND_API_KEY;

app.use(bodyParser.json());

// --- Search Hotels ---
app.get("/search-hotels", async (req, res) => {
  const { checkin, checkout, adults, city, countryCode, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const response = await sdk.getHotels(countryCode, city, 0, 10);
    const data = response.data;
    const hotelIds = data.map((hotel) => hotel.id);

    const rates = (
      await sdk.getFullRates({
        hotelIds,
        occupancies: [{ adults: parseInt(adults, 10) }],
        currency: "USD",
        guestNationality: "US",
        checkin,
        checkout,
      })
    ).data;

    rates.forEach((rate) => {
      rate.hotel = data.find((hotel) => hotel.id === rate.hotelId);
    });

    res.json({ rates });
  } catch (error) {
    console.error("Error searching for hotels:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Search Rates ---
app.get("/search-rates", async (req, res) => {
  const { checkin, checkout, adults, hotelId, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  try {
    const rates = (
      await sdk.getFullRates({
        hotelIds: [hotelId],
        occupancies: [{ adults: parseInt(adults, 10) }],
        currency: "USD",
        guestNationality: "US",
        checkin,
        checkout,
      })
    ).data;

    const hotelsResponse = await sdk.getHotelDetails(hotelId);
    const hotelInfo = hotelsResponse.data;

    const rateInfo = rates.map((hotel) =>
      hotel.roomTypes.flatMap((roomType) => {
        const boardTypes = ["RO", "BI"];
        return boardTypes
          .map((boardType) => {
            const filteredRates = roomType.rates.filter((rate) => rate.boardType === boardType);
            const sortedRates = filteredRates.sort((a, b) => {
              if (a.cancellationPolicies.refundableTag === "RFN" && b.cancellationPolicies.refundableTag !== "RFN") {
                return -1;
              } else if (b.cancellationPolicies.refundableTag === "RFN" && a.cancellationPolicies.refundableTag !== "RFN") {
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
                refundableTag: rate.cancellationPolicies.refundableTag,
                retailRate: rate.retailRate.total[0].amount,
                originalRate: rate.retailRate.suggestedSellingPrice[0].amount,
              };
            }
            return null;
          })
          .filter((rate) => rate !== null);
      })
    );
    res.json({ hotelInfo, rateInfo });
  } catch (error) {
    console.error("Error fetching rates:", error);
    res.status(500).json({ error: "No availability found" });
  }
});

// --- Prebook ---
app.post("/prebook", async (req, res) => {
  const { rateId, environment, voucherCode } = req.body;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  const bodyData = { offerId: rateId, usePaymentSdk: true };
  if (voucherCode) bodyData.voucherCode = voucherCode;

  try {
    const response = await sdk.preBook(bodyData);
    res.json({ success: response });
  } catch (err) {
    console.error("Prebook error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// --- Book ---
app.get("/book", async (req, res) => {
  const { prebookId, guestFirstName, guestLastName, guestEmail, transactionId, environment } = req.query;
  const apiKey = environment === "sandbox" ? sandbox_apiKey : prod_apiKey;
  const sdk = liteApi(apiKey);

  const bodyData = {
    holder: { firstName: guestFirstName, lastName: guestLastName, email: guestEmail },
    payment: { method: "TRANSACTION_ID", transactionId },
    prebookId,
    guests: [{ occupancyNumber: 1, firstName: guestFirstName, lastName: guestLastName, email: guestEmail }],
  };

  try {
    const data = await sdk.book(bodyData);
    res.json({ booking: data });
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ error: "Booking failed" });
  }
});

// --- Start server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ API server running on port ${port}`);
});
