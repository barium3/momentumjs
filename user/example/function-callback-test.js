// @filename: function-callback-test
// 回调函数测试

function setup() {
  size(800, 400);
  noStroke();
}

function draw() {
  // 使用回调函数处理数组
  const numbers = [1, 2, 3, 4, 5];

  processArray(numbers, function(n) {
    return n * 10;
  }, 50);

  // 使用筛选回调
  filterArray(numbers, function(n) {
    return n > 2;
  }, 300);
}

// 处理数组的回调函数
function processArray(arr, callback, startX) {
  for (let i = 0; i < arr.length; i++) {
    const result = callback(arr[i]);
    fill(255, 100 + i * 30, 100);
    ellipse(startX + i * 60, 150, result, result);
  }
}

// 筛选回调
function filterArray(arr, callback, startX) {
  let filteredIndex = 0;
  for (let i = 0; i < arr.length; i++) {
    if (callback(arr[i])) {
      fill(100, 200, 255);
      ellipse(startX + filteredIndex * 60, 300, 40, 40);
      filteredIndex++;
    }
  }
}
