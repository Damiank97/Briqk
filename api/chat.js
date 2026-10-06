const PROMPTS = {
  assistant: `Je bent de vriendelijke AI-assistent van Briqk, een Nederlands bedrijf dat AI-powered websites, automatiseringen en Micro-SaaS tools bouwt voor MKB.

Briqk biedt:
- Starter Website: €850 eenmalig + €99/mnd
- Pro Website + Chatbot: €1.750 + €249/mnd
- Chatbot Add-on: €600 + €149/mnd
- WhatsApp Bot: €750 + €149/mnd
- Lead Qualifier Agent: €950 + €199/mnd
- AI Automatisering: op aanvraag
- Micro-SaaS Tools: op aanvraag

Live binnen 2 weken. Geen verborgen kosten. Arnhem, ook remote. info@briqk.nl

Beantwoord vragen kort en vriendelijk in het Nederlands. Maximaal 2-3 zinnen. Stimuleer bezoekers om een gratis gesprek in te plannen.`,

  qualifier: `Je bent een vriendelijke assistent van Briqk. Beoordeel de antwoorden en geef een korte afsluiting van maximaal 2 zinnen. Geef geen analyse of uitleg en beweer nooit dat iemand contact opneemt: de demo verzamelt geen contactgegevens.

Warm: "Top, dit klinkt als een goede match! Laat via het contactformulier je naam en e-mailadres achter voor een gratis kennismaking."
Koud: "Goed om te weten! Mocht je er klaar voor zijn, dan staan we voor je klaar."
Niet relevant: "Bedankt voor je interesse! Dit valt helaas buiten ons werkgebied."

Schrijf altijd in maximaal 2 korte zinnen.`,

  mail: `Je bent de AI e-mailassistent van Briqk, een bedrijf dat AI-websites en automatiseringen bouwt voor Nederlands MKB. Prijzen: Starter Website €850 + €99/mnd, Pro + Chatbot €1.750 + €249/mnd, Chatbot Add-on €600 + €149/mnd.

Analyseer de inkomende e-mail en geef uitsluitend een geldig JSON-object met exact deze velden:
{"categorie":"LEAD|VRAAG|SPAM","prioriteit":"HOOG|NORMAAL|LAAG","antwoord":"[maximaal 80 woorden, professioneel Nederlands, ondertekend met Damian van Briqk]"}

Bij spam geef je geen inhoudelijk antwoord en zet je antwoord op "Deze mail wordt automatisch genegeerd."`
};

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 12;
const rateLimitStore = globalThis.__briqkRateLimitStore || new Map();
globalThis.__briqkRateLimitStore = rateLimitStore;

function getAllowedOrigins() {
  const origins = new Set(['https://briqk.nl', 'https://www.briqk.nl']);
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  String(process.env.SITE_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .forEach(origin => origins.add(origin));
  return origins;
}

function getRequestOrigin(req) {
  if (typeof req.headers.origin === 'string') return req.headers.origin;
  if (typeof req.headers.referer !== 'string') return '';
  try {
    return new URL(req.headers.referer).origin;
  } catch {
    return '';
  }
}

function checkRateLimit(key) {
  const now = Date.now();
  if (rateLimitStore.size > 1000) {
    for (const [storedKey, value] of rateLimitStore) {
      if (now >= value.resetAt) rateLimitStore.delete(storedKey);
    }
  }
  const current = rateLimitStore.get(key);
  if (!current || now >= current.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (current.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Alleen POST-verzoeken zijn toegestaan.' });
  }

  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'Gebruik application/json voor dit verzoek.' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return res.status(413).json({ error: 'Het verzoek is te groot.' });
  }

  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin || !getAllowedOrigins().has(requestOrigin)) {
    return res.status(403).json({ error: 'Dit verzoek is niet toegestaan.' });
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'onbekend');
  const clientKey = forwardedFor.split(',')[0].trim();
  const rateLimit = checkRateLimit(clientKey);
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', String(rateLimit.retryAfter));
    return res.status(429).json({ error: 'Je hebt de demo vaak gebruikt. Probeer het over een paar minuten opnieuw.' });
  }

  const message = typeof req.body?.message === 'string'
    ? req.body.message.trim()
    : '';
  const mode = typeof req.body?.mode === 'string'
    ? req.body.mode
    : 'assistant';

  if (!message) {
    return res.status(400).json({ error: 'Vul eerst een bericht in.' });
  }

  if (message.length > 2000) {
    return res.status(400).json({ error: 'Het bericht is te lang.' });
  }

  if (!Object.hasOwn(PROMPTS, mode)) {
    return res.status(400).json({ error: 'Onbekende chatbotmodus.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY ontbreekt.');
    return res.status(503).json({
      error: 'De AI-demo is tijdelijk niet beschikbaar. Mail ons via info@briqk.nl.'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const requestBody = {
      model: 'llama-3.1-8b-instant',
      max_tokens: mode === 'mail' ? 400 : 300,
      temperature: mode === 'mail' ? 0.2 : 0.7,
      messages: [
        { role: 'system', content: PROMPTS[mode] },
        { role: 'user', content: message }
      ]
    };

    if (mode === 'mail') {
      requestBody.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq API fout:', response.status, data.error?.message);
      return res.status(502).json({
        error: 'De AI-demo kan nu niet antwoorden. Probeer het zo nog eens.'
      });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return res.status(502).json({
        error: 'De AI-demo gaf geen antwoord. Probeer het opnieuw.'
      });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({
        error: 'De AI-demo reageert te langzaam. Probeer het zo nog eens.'
      });
    }

    console.error('AI-verbindingsfout:', error);
    return res.status(502).json({
      error: 'De AI-demo is tijdelijk niet bereikbaar. Probeer het later opnieuw.'
    });
  } finally {
    clearTimeout(timeout);
  }
}
