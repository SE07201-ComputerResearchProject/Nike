const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const partnerCode = "YOUR_PARTNER_CODE";
const accessKey = "YOUR_ACCESS_KEY";
const secretKey = "YOUR_SECRET_KEY";

app.post("/payment", async (req, res) => {
    const { amount } = req.body;

    const requestId = partnerCode + new Date().getTime();
    const orderId = requestId;

    const rawSignature =
        "accessKey=" + accessKey +
        "&amount=" + amount +
        "&extraData=" +
        "&ipnUrl=http://localhost:3000/ipn" +
        "&orderId=" + orderId +
        "&orderInfo=Thanh toan don hang" +
        "&partnerCode=" + partnerCode +
        "&redirectUrl=http://localhost:3000/success" +
        "&requestId=" + requestId +
        "&requestType=captureWallet";

    const signature = crypto
        .createHmac("sha256", secretKey)
        .update(rawSignature)
        .digest("hex");

    const requestBody = {
        partnerCode,
        accessKey,
        requestId,
        amount,
        orderId,
        orderInfo: "Thanh toan don hang",
        redirectUrl: "http://localhost:3000/success",
        ipnUrl: "http://localhost:3000/ipn",
        extraData: "",
        requestType: "captureWallet",
        signature,
        lang: "vi"
    };

    try {
        const result = await axios.post(
            "https://test-payment.momo.vn/v2/gateway/api/create",
            requestBody
        );

        return res.json(result.data);
    } catch (err) {
        console.log(err);
        res.status(500).send("Payment error");
    }
});

app.listen(3000, () => console.log("Server running"));