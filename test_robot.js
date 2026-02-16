var myRobot;

function setup() {
  createCanvas(800, 600);
  // 创建一个机器人对象
  myRobot = new Robot();
}

function draw() {
  background(30);

  // 1. 调用对象的方法：根据内部逻辑自动决定行为
  myRobot.checkStatus(); 
  myRobot.update();
  myRobot.display();
}

// --- 机器人逻辑类 ---
function Robot() {
  // 属性
  this.x = 400;
  this.y = 300;
  this.energy = 100;    // 初始电量
  this.state = "PATROL"; // 初始状态：巡逻
  this.angle = 0;       // 用于圆周运动

  // 逻辑判断中心：决定现在该做什么
  this.checkStatus = function() {
    if (this.energy <= 0) {
      this.state = "CHARGING";
    } else if (this.energy < 30) {
      this.state = "LOW_POWER";
    } else if (this.energy >= 100) {
      this.state = "PATROL";
    }
  };

  // 行为执行中心：具体的运动逻辑
  this.update = function() {
    if (this.state === "PATROL") {
      this.patrolBehavior();
    } else if (this.state === "LOW_POWER") {
      this.goToCharge();
    } else if (this.state === "CHARGING") {
      this.chargeBehavior();
    }
  };

  // 行为 A：巡逻（圆周运动）
  this.patrolBehavior = function() {
    this.angle += 0.05;
    this.x = 400 + cos(this.angle) * 150;
    this.y = 300 + sin(this.angle) * 150;
    this.energy -= 0.2; // 巡逻耗电
  };

  // 行为 B：去充电（直线奔向左上角 50, 50）
  this.goToCharge = function() {
    // 简单的线性插值移向目标
    this.x += (50 - this.x) * 0.05;
    this.y += (50 - this.y) * 0.05;
    this.energy -= 0.1; // 移动也在耗电
    
    // 如果非常接近充电站，电量清零进入充电状态
    if (dist(this.x, this.y, 50, 50) < 5) {
      this.energy = 0; 
    }
  };

  // 行为 C：充电
  this.chargeBehavior = function() {
    this.energy += 1; // 快速回血
  };

  // 视觉绘制：根据不同状态画出不同的样子
  this.display = function() {
    noStroke();
    
    // 绘制充电站（静态参考）
    fill(50);
    rect(20, 20, 60, 60);

    // 根据逻辑状态改变颜色和形状
    if (this.state === "PATROL") {
      fill(0, 150, 255); // 蓝色：正常
      ellipse(this.x, this.y, 40, 40);
    } 
    else if (this.state === "LOW_POWER") {
      fill(255, 200, 0); // 黄色：警告
      // 警示灯闪烁逻辑：利用 frameCount 判断奇偶
      if (frameCount % 10 < 5) {
        ellipse(this.x, this.y, 50, 50);
      } else {
        ellipse(this.x, this.y, 40, 40);
      }
    } 
    else if (this.state === "CHARGING") {
      fill(0, 255, 100); // 绿色：充电中
      rect(this.x, this.y, 40, 40);
    }

    // 绘制电量条（视觉化逻辑数值）
    fill(100);
    rect(this.x - 20, this.y + 30, 40, 5); // 槽
    fill(0, 255, 0);
    rect(this.x - 20, this.y + 30, (this.energy / 100) * 40, 5); // 进度
  };
}
