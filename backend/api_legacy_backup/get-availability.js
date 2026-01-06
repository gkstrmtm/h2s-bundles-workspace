export default function handler(req, res) {
  // CORS support
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Generate availability for the next 90 days
  const availability = [];
  const today = new Date();
  
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    
    // Randomly mark some days as unavailable for realism, but mostly available
    const isAvailable = d.getDay() !== 0; // Closed on Sundays maybe?
    
    availability.push({
      date: `${yyyy}-${mm}-${dd}`,
      available: isAvailable
    });
  }

  return res.status(200).json({
    ok: true,
    availability: availability
  });
}
