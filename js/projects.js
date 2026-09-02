// EZ Shots portfolio data. Edit content HERE, never in the HTML.
// Each project's `id` is the URL: project.html?id=birmingham-colonial
//
// Portfolio covers are real files in /img. The gallery strip at the bottom of
// this file is still Unsplash stock, which is what IMG() is for. When real
// frames arrive, drop them in /img and replace those IMG() calls the same way.
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
    cover: "img/birmingham-colonial.jpg",
    short: "Full interior, exterior, aerials and a one minute walkthrough.",
    description: "A colonial a few streets off downtown Birmingham that needed to look as good online as it does on the street. Shot in the last hour of light so the front rooms read warm and the brick keeps its colour. Listing went live the next morning.",
    services: ["Interior photos", "Exterior photos", "Drone aerials", "1 minute video"],
    gallery: ["img/birmingham-colonial.jpg"]
  },
  {
    id: "royal-oak-craftsman",
    title: "Craftsman off Woodward",
    location: "Royal Oak, MI",
    type: "Single Family",
    sqft: "2,400 sq ft",
    pkg: "Listing Essentials",
    photos: "28 photos",
    delivered: "Delivered in 22 hours",
    cover: "img/royal-oak-craftsman.jpg",
    short: "Stone, timber and autumn colour, shot before the leaves went.",
    description: "Craftsman detail is the selling point here, so the exterior set gets in close on the stone piers, the timber brackets and the wood garage doors rather than settling for one wide shot from the curb. Booked and shot inside the same week the colour turned.",
    services: ["Interior photos", "Exterior photos", "Drone aerials"],
    gallery: ["img/royal-oak-craftsman.jpg"]
  },
  {
    id: "rochester-new-build",
    title: "New Construction Farmhouse",
    location: "Rochester Hills, MI",
    type: "New Build",
    sqft: "3,200 sq ft",
    pkg: "Listing Pro",
    photos: "40 photos + 1 min video",
    delivered: "Delivered in 24 hours",
    cover: "img/rochester-new-build.jpg",
    short: "Builder spec home shot for both the MLS and the builder's site.",
    description: "New construction is unforgiving, every line shows. Straight verticals, consistent white balance room to room, and an aerial set showing the lot and how the home sits in the new section of the subdivision. Flat overcast light was the right call on white board and batten.",
    services: ["Interior photos", "Exterior photos", "Drone aerials", "1 minute video"],
    gallery: ["img/rochester-new-build.jpg"]
  },
  {
    id: "northville-estate",
    title: "Estate off Six Mile",
    location: "Northville, MI",
    type: "Luxury",
    sqft: "5,400 sq ft",
    pkg: "Listing Pro",
    photos: "52 photos + 1 min video",
    delivered: "Delivered in 30 hours",
    cover: "img/northville-estate.jpg",
    short: "Twilight exteriors, aerials and a house lit from the inside out.",
    description: "Twilight is twenty minutes of usable light, so the whole visit is planned backwards from it. Interior lamps on, drapes open, exterior lights on early, then one set of frames while the sky still has blue in it. The agent used the lead shot for print and social.",
    services: ["Interior photos", "Drone aerials", "Twilight", "1 minute video"],
    gallery: ["img/northville-estate.jpg"]
  },
  {
    id: "troy-brick-colonial",
    title: "Brick Colonial near Somerset",
    location: "Troy, MI",
    type: "Single Family",
    sqft: "3,050 sq ft",
    pkg: "Listing Pro",
    photos: "34 photos + 1 min video",
    delivered: "Delivered in 21 hours",
    cover: "img/troy-brick-colonial.jpg",
    short: "Golden hour exteriors and a video tour for a relocation buyer pool.",
    description: "Most of the traffic on this listing was out of state relocation, so the one minute video did the heavy lifting and the exterior had to carry the thumbnail. Shot into the last of the sun with the interior lights already on. Vertical cut supplied alongside the horizontal for the agent's reels.",
    services: ["Interior photos", "Exterior photos", "Drone aerials", "1 minute video", "Vertical cut"],
    gallery: ["img/troy-brick-colonial.jpg"]
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
