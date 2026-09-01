// EZ Shots portfolio data. Edit content HERE, never in the HTML.
// Each project's `id` is the URL: project.html?id=birmingham-colonial
// Images are stock placeholders. Swap the IMG() ids for your own hosted files
// (drop them in /img and use "img/filename.jpg" instead of IMG("...")).
var IMG = function (id) {
  return "https://images.unsplash.com/photo-" + id + "?auto=format&fit=crop&w=1400&q=80";
};

window.EZ_PROJECTS = [
  {
    id: "birmingham-colonial",
    title: "Brick Colonial on Maple",
    location: "Birmingham, MI",
    type: "Single Family",
    sqft: "2,850 sq ft",
    pkg: "Listing Pro",
    photos: "38 photos + 1 min video",
    delivered: "Delivered in 19 hours",
    cover: IMG("1600596542815-ffad4c1539a9"),
    short: "Full interior, exterior, aerials and a one minute walkthrough.",
    description: "A downtown Birmingham colonial that needed to look as good online as it does on the street. Shot mid morning for even light through the front rooms, with aerials framing the tree lined block and the walk to Shain Park. Listing went live the next morning.",
    services: ["Interior photos", "Exterior photos", "Drone aerials", "1 minute video"],
    gallery: [
      IMG("1600596542815-ffad4c1539a9"),
      IMG("1600607687939-ce8a6c25118c"),
      IMG("1600585154340-be6161a56a0c"),
      IMG("1600566753086-00f18fb6b3ea"),
      IMG("1600210492486-724fe5c67fb0"),
      IMG("1770938474431-d1192cac9642")
    ]
  },
  {
    id: "royal-oak-bungalow",
    title: "Updated Bungalow near Downtown",
    location: "Royal Oak, MI",
    type: "Single Family",
    sqft: "1,450 sq ft",
    pkg: "Listing Essentials",
    photos: "28 photos",
    delivered: "Delivered in 22 hours",
    cover: IMG("1568605114967-8130f3a36994"),
    short: "Bright interiors and a clean street view for a fast moving listing.",
    description: "A renovated bungalow a few blocks off Main. Small homes live or die on how open they read, so wide but honest interior frames, windows exposed properly, and a low aerial to show the yard and the garage in one shot.",
    services: ["Interior photos", "Exterior photos", "Drone aerials"],
    gallery: [
      IMG("1568605114967-8130f3a36994"),
      IMG("1570129477492-45c003edd2be"),
      IMG("1600585152220-90363fe7e115"),
      IMG("1616486338812-3dadae4b4ace"),
      IMG("1600566753190-17f0baa2a6c3"),
      IMG("1580587771525-78b9dba3b914")
    ]
  },
  {
    id: "grosse-pointe-waterfront",
    title: "Lakefront on Lake Shore Road",
    location: "Grosse Pointe Farms, MI",
    type: "Waterfront",
    sqft: "4,100 sq ft",
    pkg: "Listing Pro + twilight",
    photos: "45 photos + 1 min video",
    delivered: "Delivered in 26 hours",
    cover: IMG("1512917774080-9991f1c4c750"),
    short: "Aerials over the water, twilight exteriors, full video tour.",
    description: "Water views are the whole pitch on this one, so the aerial set leads: the shoreline, the dock, and the house sitting against Lake St. Clair. Twilight exteriors were shot the same evening to give the agent a hero image for print and social.",
    services: ["Interior photos", "Drone aerials", "Twilight", "1 minute video"],
    gallery: [
      IMG("1512917774080-9991f1c4c750"),
      IMG("1613490493576-7fde63acd811"),
      IMG("1600047509807-ba8f99d2cdde"),
      IMG("1765601296884-eb4fabe7fc2e"),
      IMG("1600596542815-ffad4c1539a9"),
      IMG("1580216643062-cf460548a66a")
    ]
  },
  {
    id: "rochester-new-build",
    title: "New Construction Walkout",
    location: "Rochester Hills, MI",
    type: "New Build",
    sqft: "3,200 sq ft",
    pkg: "Listing Pro",
    photos: "40 photos + 1 min video",
    delivered: "Delivered in 24 hours",
    cover: IMG("1580216643062-cf460548a66a"),
    short: "Builder spec home shot for both the MLS and the builder's site.",
    description: "Empty new construction is unforgiving, every line shows. Straight verticals, consistent white balance room to room, and an aerial set showing the lot, the walkout grade and how the home sits in the new section of the subdivision.",
    services: ["Interior photos", "Exterior photos", "Drone aerials", "1 minute video"],
    gallery: [
      IMG("1580216643062-cf460548a66a"),
      IMG("1600585152220-90363fe7e115"),
      IMG("1600047509358-9dc75507daeb"),
      IMG("1780882756309-0adb22a2c11e"),
      IMG("1600607687920-4e2a09cf159d"),
      IMG("1568605114967-8130f3a36994")
    ]
  },
  {
    id: "detroit-riverfront-loft",
    title: "Riverfront Loft, Rivertown",
    location: "Detroit, MI",
    type: "Condo / Loft",
    sqft: "1,180 sq ft",
    pkg: "Listing Essentials",
    photos: "26 photos",
    delivered: "Delivered in 16 hours",
    cover: IMG("1600566753086-00f18fb6b3ea"),
    short: "Hard light, big windows and a skyline the buyer is really paying for.",
    description: "Lofts are a window exposure problem. Interiors were bracketed so the river and the skyline stay visible instead of blowing out, and the building exterior and shared amenities were shot the same visit.",
    services: ["Interior photos", "Exterior photos", "Amenities"],
    gallery: [
      IMG("1600566753086-00f18fb6b3ea"),
      IMG("1600210492486-724fe5c67fb0"),
      IMG("1600607687920-4e2a09cf159d"),
      IMG("1616486338812-3dadae4b4ace"),
      IMG("1600566753190-17f0baa2a6c3"),
      IMG("1600585154340-be6161a56a0c")
    ]
  },
  {
    id: "northville-estate",
    title: "Estate off Six Mile",
    location: "Northville, MI",
    type: "Luxury",
    sqft: "5,400 sq ft",
    pkg: "Listing Pro + twilight",
    photos: "52 photos + 1 min video",
    delivered: "Delivered in 30 hours",
    cover: IMG("1613490493576-7fde63acd811"),
    short: "Acreage, a long drive and a house that needed altitude to read.",
    description: "On acreage the ground level exterior never tells the story. The aerial set establishes the property line, the drive and the outbuildings, then the video walks a buyer from the gate to the back patio in under a minute.",
    services: ["Interior photos", "Drone aerials", "Twilight", "1 minute video"],
    gallery: [
      IMG("1613490493576-7fde63acd811"),
      IMG("1600596542815-ffad4c1539a9"),
      IMG("1765601296884-eb4fabe7fc2e"),
      IMG("1600047509807-ba8f99d2cdde"),
      IMG("1512917774080-9991f1c4c750"),
      IMG("1600607687939-ce8a6c25118c")
    ]
  },
  {
    id: "ferndale-ranch",
    title: "Mid Century Ranch",
    location: "Ferndale, MI",
    type: "Single Family",
    sqft: "1,320 sq ft",
    pkg: "Listing Essentials",
    photos: "25 photos",
    delivered: "Delivered in 18 hours",
    cover: IMG("1576941089067-2de3c901e126"),
    short: "Same day booking, gallery in the agent's inbox the next morning.",
    description: "Called in on a Tuesday afternoon, shot Wednesday morning, delivered Wednesday night. Clean ranch lines, a tidy back yard from the air, and enough detail shots to fill the MLS without padding.",
    services: ["Interior photos", "Exterior photos", "Drone aerials"],
    gallery: [
      IMG("1576941089067-2de3c901e126"),
      IMG("1616486338812-3dadae4b4ace"),
      IMG("1600566753190-17f0baa2a6c3"),
      IMG("1570129477492-45c003edd2be"),
      IMG("1600210492486-724fe5c67fb0"),
      IMG("1568605114967-8130f3a36994")
    ]
  },
  {
    id: "troy-townhome",
    title: "Townhome in Somerset Park",
    location: "Troy, MI",
    type: "Townhouse",
    sqft: "1,900 sq ft",
    pkg: "Listing Pro",
    photos: "34 photos + 1 min video",
    delivered: "Delivered in 21 hours",
    cover: IMG("1600607687939-ce8a6c25118c"),
    short: "Interior video tour for a relocation buyer pool.",
    description: "Most of the traffic on this listing was out of state relocation, so the one minute video did the heavy lifting. Vertical cut supplied alongside the horizontal for the agent's reels.",
    services: ["Interior photos", "Exterior photos", "1 minute video", "Vertical cut"],
    gallery: [
      IMG("1600607687939-ce8a6c25118c"),
      IMG("1600585154340-be6161a56a0c"),
      IMG("1600047509358-9dc75507daeb"),
      IMG("1600585152220-90363fe7e115"),
      IMG("1600566753086-00f18fb6b3ea"),
      IMG("1580587771525-78b9dba3b914")
    ]
  }
];

// Standalone frames for the gallery page and the home page strip.
window.EZ_GALLERY = [
  IMG("1600585154340-be6161a56a0c"),
  IMG("1600566753086-00f18fb6b3ea"),
  IMG("1512917774080-9991f1c4c750"),
  IMG("1568605114967-8130f3a36994"),
  IMG("1600607687939-ce8a6c25118c"),
  IMG("1580216643062-cf460548a66a"),
  IMG("1613490493576-7fde63acd811"),
  IMG("1576941089067-2de3c901e126"),
  IMG("1600210492486-724fe5c67fb0"),
  IMG("1570129477492-45c003edd2be"),
  IMG("1600047509807-ba8f99d2cdde"),
  IMG("1616486338812-3dadae4b4ace"),
  IMG("1770938474431-d1192cac9642"),
  IMG("1600585152220-90363fe7e115"),
  IMG("1765601296884-eb4fabe7fc2e"),
  IMG("1600566753190-17f0baa2a6c3"),
  IMG("1770936996689-e2a9d61a144f"),
  IMG("1565402170291-8491f14678db")
];
