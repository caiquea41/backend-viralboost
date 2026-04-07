const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();

app.use(cors());
app.use(express.json());

// 🔗 CONFIGURAÇÃO SMMWIZ
const API_URL = "https://smmwiz.com/api/v2";
const API_KEY = "4829473ac02c1ed8c3f666d5893fecba";
const SERVICE_ID = 20018;

// 💰 CONFIG MERCADO PAGO
const client = new MercadoPagoConfig({
  accessToken: "APP_USR-7916377909351682-040714-371cc903e48b3137c98cca4c283f8f10-1263880545"
});

// ROTA TESTE
app.get("/", (req, res) => {
  res.send("Backend online 🚀");
});

// 🚀 ROTA DE PEDIDO REAL
app.post("/order", async (req, res) => {
  const { link, quantidade } = req.body;

  try {
    const response = await axios.post(API_URL, {
      key: API_KEY,
      action: "add",
      service: SERVICE_ID,
      link: link,
      quantity: quantidade
    });

    console.log("Resposta do painel:", response.data);

    res.json(response.data);
  } catch (error) {
    console.log("Erro:", error.response?.data || error.message);

    res.status(500).json({
      error: "Erro ao enviar pedido"
    });
  }
});

// 💳 ROTA PIX
app.post("/pix", async (req, res) => {
  return res.json({ ok: true, valor: req.body.valor });
});
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recebido:", req.body);

    const paymentId = req.body.data.id;

    const payment = new Payment(client);

    const paymentInfo = await payment.get({ id: paymentId });

    // verifica se foi pago
    if (paymentInfo.status === "approved") {
      console.log("Pagamento aprovado!");

      // ⚠️ AQUI você envia pro SMM
      await axios.post(API_URL, {
        key: API_KEY,
        action: "add",
        service: SERVICE_ID,
        link: "https://instagram.com/teste", // depois vamos pegar isso dinâmico
        quantity: 100
      });
    }

    res.sendStatus(200);

  } catch (error) {
    console.log("Erro webhook:", error);
    res.sendStatus(500);
  }
});
// 🚀 PORTA (SEMPRE POR ÚLTIMO)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando 🚀");
});