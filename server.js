const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();

/**
 * CORS
 */
const corsOptions = {
  origin: [
    "https://viralboostbr.com",
    "https://www.viralboostbr.com",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.options("/pix", cors(corsOptions));
app.options("/order", cors(corsOptions));
app.options("/webhook", cors(corsOptions));
app.options("/pedido/:paymentId", cors(corsOptions));

app.use(express.json());

/**
 * CONFIG
 */
const API_URL = "https://smmwiz.com/api/v2";
const API_KEY = process.env.SMMWIZ_API_KEY || "SUA_API_KEY_SMMWIZ";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "SEU_ACCESS_TOKEN_MP";

const client = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN
});

/**
 * Armazenamento temporário em memória
 * Depois, se quiser, a gente troca por banco de dados
 */
const pedidos = {};

/**
 * Rota teste
 */
app.get("/", (req, res) => {
  res.send("Backend online 🚀");
});

/**
 * GERAR PIX
 */
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
    email,
    upsell_active,
    upsell_extra_quantity,
    upsell_price
  } = req.body;

  try {
    const numericValor = Number(valor);

    if (!numericValor || numericValor <= 0) {
      return res.status(400).json({
        error: "Valor inválido para gerar PIX."
      });
    }

    const payment = new Payment(client);

    const result = await payment.create({
      body: {
        transaction_amount: numericValor,
        description: `Compra ViralBoost - ${network || ""} ${service || ""}`.trim(),
        payment_method_id: "pix",
        payer: {
          email: email || "comprador@viralboostbr.com",
          first_name: name || "Cliente"
        }
      }
    });

    const paymentId = result.id;
    const qrCode = result.point_of_interaction?.transaction_data?.qr_code || null;
    const qrCodeBase64 = result.point_of_interaction?.transaction_data?.qr_code_base64 || null;

    pedidos[paymentId] = {
      payment_id: paymentId,
      valor: numericValor,
      link: link || "",
      quantidade: Number(quantidade) || 0,
      service_id: Number(service_id) || 0,
      service: service || "",
      network: network || "",
      package_amount: package_amount || "",
      name: name || "",
      email: email || "",
      upsell_active: Boolean(upsell_active),
      upsell_extra_quantity: Number(upsell_extra_quantity) || 0,
      upsell_price: Number(upsell_price) || 0,
      status: "pending",
      smm_order_id: null,
      smm_response: null,
      smm_error: null,
      created_at: new Date().toISOString(),
      sent_at: null
    };

    return res.json({
      payment_id: paymentId,
      status: result.status || "pending",
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64
    });
  } catch (error) {
    console.log("ERRO PIX COMPLETO:");
    console.log(JSON.stringify(error, null, 2));

    return res.status(500).json({
      error: "Erro ao gerar PIX",
      detalhe: error?.message || null,
      causa: error?.cause || null
    });
  }
});

/**
 * CRIAR PEDIDO MANUAL NO SMMWIZ
 */
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

/**
 * WEBHOOK DO MERCADO PAGO
 */
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recebido:", JSON.stringify(req.body, null, 2));

    const paymentId = req.body?.data?.id;
    const liveMode = req.body?.live_mode;
    const eventType = req.body?.type;
    const action = req.body?.action;

    // Webhook de teste/simulação
    if (liveMode === false) {
      console.log("Webhook de teste recebido. Retornando 200 sem processar.");
      return res.sendStatus(200);
    }

    // Sem paymentId
    if (!paymentId) {
      console.log("Webhook sem paymentId. Retornando 200.");
      return res.sendStatus(200);
    }

    // Processa apenas eventos de pagamento
    if (eventType !== "payment" && action !== "payment.updated") {
      console.log("Evento ignorado:", eventType || action);
      return res.sendStatus(200);
    }

    const payment = new Payment(client);
    const paymentInfo = await payment.get({ id: paymentId });

    if (paymentInfo.status !== "approved") {
      console.log("Pagamento ainda não aprovado:", paymentInfo.status);
      return res.sendStatus(200);
    }

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
      const quantidadeFinal = Number(pedido.quantidade) + Number(pedido.upsell_extra_quantity || 0);

      const smmResponse = await axios.post(API_URL, {
        key: API_KEY,
        action: "add",
        service: Number(pedido.service_id),
        link: pedido.link,
        quantity: quantidadeFinal
      });

      pedido.status = "sent";
      pedido.smm_response = smmResponse.data;
      pedido.smm_order_id = smmResponse.data?.order || null;
      pedido.sent_at = new Date().toISOString();

      console.log("Pedido enviado ao SMMWiz:", smmResponse.data);
    } catch (smmError) {
      pedido.status = "error";
      pedido.smm_error = smmError.response?.data || smmError.message;

      console.log("Erro ao enviar ao SMMWiz:");
      console.log(smmError.response?.data || smmError.message);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.log("ERRO NO WEBHOOK:");
    console.log(error.response?.data || error.message || error);

    // Mantém 200 para o Mercado Pago não ficar rebatendo teste
    return res.sendStatus(200);
  }
});

/**
 * CONSULTAR PEDIDO SALVO
 */
app.get("/pedido/:paymentId", (req, res) => {
  const pedido = pedidos[req.params.paymentId];

  if (!pedido) {
    return res.status(404).json({ error: "Pedido não encontrado" });
  }

  return res.json({
    payment_id: pedido.payment_id,
    status: pedido.status,
    valor: pedido.valor,
    link: pedido.link,
    quantidade: pedido.quantidade,
    service_id: pedido.service_id,
    service: pedido.service,
    network: pedido.network,
    package_amount: pedido.package_amount,
    name: pedido.name,
    email: pedido.email,
    upsell_active: pedido.upsell_active,
    upsell_extra_quantity: pedido.upsell_extra_quantity,
    upsell_price: pedido.upsell_price,
    smm_order_id: pedido.smm_order_id,
    smm_response: pedido.smm_response,
    smm_error: pedido.smm_error,
    created_at: pedido.created_at,
    sent_at: pedido.sent_at
  });
});

/**
 * START SERVER
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT} 🚀`);
});