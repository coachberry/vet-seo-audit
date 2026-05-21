// API calls and job polling
async function startAndPoll(payload, outputId, steps, onComplete, onError) {
  var iv = showLoading(outputId, 'PROCESSING', steps);
  try {
    var startRes = await fetch(FUNCTIONS_BASE_URL + '/startAudit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!startRes.ok) throw new Error('Failed to start job: ' + startRes.status);
    var startData = await startRes.json();
    var jobId = startData.jobId;
    var pollCount = 0;
    var pollInterval = setInterval(async function() {
      pollCount++;
      if (pollCount > 120) {
        clearInterval(pollInterval); clearInterval(iv);
        onError('Job timed out after 10 minutes');
        return;
      }
      try {
        var pollRes = await fetch(FUNCTIONS_BASE_URL + '/getJob?jobId=' + jobId);
        var job = await pollRes.json();
        if (job.status === 'complete') {
          clearInterval(pollInterval); clearInterval(iv);
          onComplete(job.result);
        } else if (job.status === 'error') {
          clearInterval(pollInterval); clearInterval(iv);
          onError(job.error || 'Job failed');
        }
      } catch(e) { /* keep polling on network hiccup */ }
    }, 5000);
  } catch(e) {
    clearInterval(iv);
    onError(e.message);
  }
}

async function saveToFirestore(type, domain, data) {
  try {
    await db.collection('audits').add({
      type: type, domain: domain,
      createdAt: new Date().toISOString(), data: data
    });
  } catch(e) { console.warn('Firestore save failed:', e.message); }
}
