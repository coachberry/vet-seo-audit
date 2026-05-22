async function analyzeContentMap(crawlData, client) {
  const { pages, domain } = crawlData;

  const blogPages = pages.filter(p => p.isBlog && p.pageTitle);
  const servicePages = pages.filter(p =>
    !p.isBlog &&
    /\/services\//i.test(p.url) &&
    !/\/blog/i.test(p.url) &&
    p.pageTitle &&
    (p.wordCount || 0) > 50
  );

  console.log('[contentMap] blogs:', blogPages.length, 'services:', servicePages.length);

  if (!blogPages.length || !servicePages.length) {
    return {
      domain, totalBlogPages: blogPages.length, totalServicePages: servicePages.length,
      mappings: [], unmappedBlogs: blogPages.map(p => ({ url: p.url, title: p.pageTitle, reason: 'No service pages found' })),
      servicePages: servicePages.map(p => ({ url: p.url, title: p.pageTitle }))
    };
  }

  const serviceList = servicePages.slice(0, 150).map(p => ({
    url: p.url, title: p.pageTitle,
    path: p.url.replace(/https?:\/\/[^\/]+/, '')
  }));

  const BATCH_SIZE = 40;
  const allMappings = [];
  const allUnmapped = [];

  for (let i = 0; i < blogPages.length; i += BATCH_SIZE) {
    const batch = blogPages.slice(i, i + BATCH_SIZE);
    const blogList = batch.map(p => ({
      url: p.url, title: p.pageTitle,
      path: p.url.replace(/https?:\/\/[^\/]+/, '')
    }));

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: 'You are a veterinary SEO expert building internal linking strategies. Match blog posts to service pages. Respond ONLY with valid JSON.',
      messages: [{
        role: 'user',
        content: `Match each blog post to the most relevant service page for internal linking.

SERVICE PAGES:
${JSON.stringify(serviceList)}

BLOG POSTS:
${JSON.stringify(blogList)}

Respond JSON ONLY:
{
  "mappings": [
    {
      "blogUrl": "full blog URL",
      "blogTitle": "blog title",
      "serviceUrl": "full service URL",
      "serviceTitle": "service page title",
      "confidence": "high|medium|low",
      "reason": "one sentence why this blog matches this service page"
    }
  ],
  "unmapped": [
    { "url": "blog URL", "title": "blog title", "reason": "why no service page matches" }
  ]
}`
      }]
    });

    const raw = msg.content.find(b => b.type === 'text')?.text || '{}';
    try {
      let jsonStr = raw.replace(/```json|```/g, '').trim();
      const fb = jsonStr.indexOf('{'), lb = jsonStr.lastIndexOf('}');
      if (fb !== -1 && lb !== -1) jsonStr = jsonStr.substring(fb, lb + 1);
      const parsed = JSON.parse(jsonStr);
      allMappings.push(...(parsed.mappings || []));
      allUnmapped.push(...(parsed.unmapped || []));
    } catch(e) {
      console.error('[contentMap] batch parse error:', e.message);
    }

    // Small delay between batches
    if (i + BATCH_SIZE < blogPages.length) await new Promise(r => setTimeout(r, 500));
  }

  return {
    domain, totalBlogPages: blogPages.length, totalServicePages: servicePages.length,
    mappings: allMappings, unmappedBlogs: allUnmapped,
    servicePages: serviceList
  };
}

module.exports = { analyzeContentMap };
