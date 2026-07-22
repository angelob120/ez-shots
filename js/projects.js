// EZ Shots — portfolio data. FILLER content — replace images & text later.
// Each project's `id` is used in the URL: project.html?id=modern-estate
var IMG = function (id) {
  return "https://images.unsplash.com/photo-" + id + "?auto=format&fit=crop&w=1200&q=80";
};

window.EZ_PROJECTS = [
  {
    id: "modern-estate",
    title: "Modern Hillside Estate",
    location: "Placeholder City, ST",
    type: "Luxury Home",
    cover: IMG("1600596542815-ffad4c1539a9"),
    short: "Full photo, video & drone package.",
    description: "Filler description — replace later.",
    services: ["Photos", "1-Min Video", "Drone", "Twilight"],
    gallery: [
      IMG("1600596542815-ffad4c1539a9"),
      IMG("1600607687939-ce8a6c25118c"),
      IMG("1600585154340-be6161a56a0c"),
      IMG("1600566753086-00f18fb6b3ea"),
      IMG("1600210492486-724fe5c67fb0"),
      IMG("1600607687920-4e2a09cf159d")
    ]
  },
  {
    id: "downtown-loft",
    title: "Downtown Loft",
    location: "Placeholder City, ST",
    type: "Condo / Loft",
    cover: IMG("1600566753086-00f18fb6b3ea"),
    short: "Bright, open-concept interiors.",
    description: "Filler description — replace later.",
    services: ["Photos", "Interiors"],
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
    id: "suburban-family",
    title: "Suburban Family Home",
    location: "Placeholder City, ST",
    type: "Single Family",
    cover: IMG("1568605114967-8130f3a36994"),
    short: "Full interior, exterior & drone.",
    description: "Filler description — replace later.",
    services: ["Photos", "Drone", "1-Min Video"],
    gallery: [
      IMG("1568605114967-8130f3a36994"),
      IMG("1570129477492-45c003edd2be"),
      IMG("1580587771525-78b9dba3b914"),
      IMG("1600585152220-90363fe7e115"),
      IMG("1600047509807-ba8f99d2cdde"),
      IMG("1600566753086-00f18fb6b3ea")
    ]
  },
  {
    id: "waterfront-villa",
    title: "Waterfront Villa",
    location: "Placeholder City, ST",
    type: "Luxury Home",
    cover: IMG("1512917774080-9991f1c4c750"),
    short: "Drone, video & twilight.",
    description: "Filler description — replace later.",
    services: ["Photos", "1-Min Video", "Drone", "Twilight"],
    gallery: [
      IMG("1512917774080-9991f1c4c750"),
      IMG("1613490493576-7fde63acd811"),
      IMG("1600047509807-ba8f99d2cdde"),
      IMG("1600585154340-be6161a56a0c"),
      IMG("1600596542815-ffad4c1539a9"),
      IMG("1580216643062-cf460548a66a")
    ]
  },
  {
    id: "cozy-townhouse",
    title: "Cozy Townhouse",
    location: "Placeholder City, ST",
    type: "Townhouse",
    cover: IMG("1576941089067-2de3c901e126"),
    short: "Wide-angle interior photography.",
    description: "Filler description — replace later.",
    services: ["Photos", "Interiors"],
    gallery: [
      IMG("1576941089067-2de3c901e126"),
      IMG("1616486338812-3dadae4b4ace"),
      IMG("1600566753190-17f0baa2a6c3"),
      IMG("1600210492486-724fe5c67fb0"),
      IMG("1600607687920-4e2a09cf159d"),
      IMG("1568605114967-8130f3a36994")
    ]
  },
  {
    id: "new-construction",
    title: "New Construction Showcase",
    location: "Placeholder City, ST",
    type: "New Build",
    cover: IMG("1580216643062-cf460548a66a"),
    short: "Full marketing package.",
    description: "Filler description — replace later.",
    services: ["Photos", "1-Min Video", "Drone"],
    gallery: [
      IMG("1580216643062-cf460548a66a"),
      IMG("1600585152220-90363fe7e115"),
      IMG("1600047509358-9dc75507daeb"),
      IMG("1600596542815-ffad4c1539a9"),
      IMG("1512917774080-9991f1c4c750"),
      IMG("1568605114967-8130f3a36994")
    ]
  }
];

// Extra images for the home-page gallery strip
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
  IMG("1616486338812-3dadae4b4ace")
];
