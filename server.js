const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

// CONFIG
const API_URL = "https://smmwiz.com/api/v2";
const API_KEY = process.env.SMMWIZ_API_KEY || "4829473ac02c1ed8c3f666d5893fecba";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "TEST-7916377909351682-040714-df01234fd2626c34c15da7481cbc1981-1263880545";

const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN
});

// armazenamento simples temporário dos pedidos
// depois, se quiser, a gente troca por banco de dados
const pedidos = {};

// rota teste
app.get("/", (req, res) => {
  res.send("Backend online 🚀");
});

// gerar PIX
app.post("/pix", async (req, res) => {
  const {
    valor,
    link,
    quantidade,
    service_id,
    service,
    network,
    package_amount,
    name,
    email
  } = req.body;

  try {
    const payment = new Payment(client);

    const result = await payment.create({
      body: {
        transaction_amount: Number(valor),
        description: `Compra ViralBoost - ${network || ""} ${service || ""}`.trim(),
        payment_method_id: "pix",
        payer: {
          email: email || "comprador@viralboostbr.com",
          first_name: name || "Cliente"
        }
      }
    });

    const paymentId = result.id;
    const qrCode = result.point_of_interaction?.transaction_data?.qr_code;
    const qrCodeBase64 = result.point_of_interaction?.transaction_data?.qr_code_base64;

    // salva os dados do pedido pelo paymentId
    pedidos[paymentId] = {
      payment_id: paymentId,
      valor: Number(valor),
      link,
      quantidade: Number(quantidade),
      service_id: Number(service_id),
      service,
      network,
      package_amount,
      name,
      email,
      status: "pending",
      created_at: new Date().toISOString()
    };

    return res.json({
      payment_id: paymentId,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64
    });
  } catch (error) {
    console.log("ERRO AO GERAR PIX:");
    console.log(error);

    return res.status(500).json({
      error: "Erro ao gerar PIX",
      detalhe: error?.message || null,
      causa: error?.cause || null
    });
  }
});

// criar pedido manualmente no SMMWiz
app.post("/order", async (req, res) => {
  const { link, quantidade, service_id } = req.body;

  try {
    const response = await axios.post(API_URL, {
      key: API_KEY,
      action: "add",
      service: Number(service_id),
      link: link,
      quantity: Number(quantidade)
    });

    return res.json(response.data);
  } catch (error) {
    console.log("ERRO SMMWIZ:");
    console.log(error.response?.data || error.message);

    return res.status(500).json({
      error: "Erro ao enviar pedido ao SMMWiz",
      detalhe: error.response?.data || error.message
    });
  }
});

// webhook do Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

    const eventType = req.body.type || req.body.action;
    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      return res.sendStatus(200);
    }

    const payment = new Payment(client);
    const paymentInfo = await payment.get({ id: paymentId });

    if (paymentInfo.status === "approved") {
      const pedido = pedidos[paymentId];

      if (!pedido) {
        console.log("Pedido não encontrado para payment_id:", paymentId);
        return res.sendStatus(200);
      }

      if (pedido.status === "approved" || pedido.status === "sent") {
        console.log("Pedido já processado:", paymentId);
        return res.sendStatus(200);
      }

      pedido.status = "approved";

      try {
        const smmResponse = await axios.post(API_URL, {
          key: API_KEY,
          action: "add",
          service: Number(pedido.service_id),
          link: pedido.link,
          quantity: Number(pedido.quantidade)
        });

        pedido.status = "sent";
        pedido.smm_response = smmResponse.data;
        pedido.sent_at = new Date().toISOString();

        console.log("Pedido enviado ao SMMWiz:", smmResponse.data);
      } catch (smmError) {
        pedido.status = "error";
        pedido.smm_error = smmError.response?.data || smmError.message;

        console.log("Erro ao enviar ao SMMWiz:");
        console.log(smmError.response?.data || smmError.message);
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.log("ERRO NO WEBHOOK:");
    console.log(error);
    return res.sendStatus(500);
  }
});

// consultar pedido salvo
app.get("/pedido/:paymentId", (req, res) => {
  const pedido = pedidos[req.params.paymentId];

  if (!pedido) {
    return res.status(404).json({ error: "Pedido não encontrado" });
  }

  return res.json(pedido);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando 🚀");
});