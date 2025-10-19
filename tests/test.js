const fs = require("fs");

test("satellite data file exists", () => {
  const filePath = "./public/data/satellite25544/index.json";
  if (!fs.existsSync(filePath)) {
    throw new Error(" Expected data file not found!");
  }
  console.log(" Data file exists");
});
