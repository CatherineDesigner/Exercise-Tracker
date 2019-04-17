const express = require('express');
const app = express();
const cors = require('cors');
var bodyParser = require('body-parser');
var urlencodedParser = bodyParser.urlencoded({ extended: false });
const shortid = require('shortid');
const keys = require('./keys');

const mongoose = require('mongoose');
mongoose.connect(process.env.mongoURI || 'mongodb://localhost/exercise-track',{ useNewUrlParser: true })
.then(() => console.log('MongoDB connected.'))
.catch(err => console.error(err))

//Схема/модель
const userSchema = new mongoose.Schema({
  username: {type: String, required: true, maxlength: 20, unique: true}
});
const User = mongoose.model('GymUsers', userSchema);

const logSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  description: { type: String, required: true },
  duration: { type: Number, required: true },
  date: { type: Date, default: Date.now }
});
const Log = mongoose.model('GymLog', logSchema);


app.use(cors());
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());

app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});

//создать пользователя, разместив имя пользователя с данными формы в /api /exerc /new-user, и возвращаемым будет объект с именем пользователя и _id. Данные упадут в БД.
app.post("/api/exercise/new-user", function (req, res, next) {
  const newUser = new User({username: req.body.username});

  newUser.save(function (error, data) {
    if (error) {
//   console.log(error);
      if (error.errors &&
          error.errors.username &&
          error.errors.username['$isValidatorError'] &&
          error.errors.username.kind == 'maxlength') {
        return next({
          status: 400,
          message: 'username too long'
        });
      }

      if (error.code == 11000) return next({
        status: 400,
        message: 'username already taken'
      });
      return next(error);
     }

    res.json({
      username: data.username,
      _id: data._id
    });
  });
});

//добавить упражнение любому пользователю, опубликовав данные формы userId (_id), описание, продолжительность и, опционально, дату в/api/упражнение/ добавить. Если дата не указана, будет использоваться текущая дата. Возвращается объект пользователя с добавленными полями упражнений.
app.post("/api/exercise/add", function (req, res, next) {

  User.findById(req.body.userId,
                'username',
                {lean: true},
                function (error, user) {

    if (error) {
      if (error.name == 'CastError' &&
          error.kind == 'ObjectId' &&
          error.path == '_id') {
        return next({
          status: 400,
          message: 'unknown _id'
        });
      }

      console.log('Error finding user _id:\n', error);
      return next(error);
    }

    if (!user) return next({
      status: 400,
      message: 'unknown _id'
    });

    const entry = {
      userId: req.body.userId,
      description: req.body.description,
      duration: req.body.duration
    };

    if (req.body.date) entry.date = req.body.date;

    const exercise = new Log(entry);

    exercise.save(function (error, exercise) {

      if (error) return next(error);

      res.json({
        username: user.username,
        _id: user._id,
        description: exercise.description,
        duration: exercise.duration,
        date: exercise.date.toDateString()
      });
    });
  });
});

//Я могу получить полный журнал упражнений любого пользователя, получив /api/exerc/log с параметром userId (_id). Возврат будет пользовательским объектом с добавленным массивом log и count (общее количество упражнений).
//Я могу получить часть журнала любого пользователя, также передавая необязательные параметры от и до или ограничения. (Формат даты гггг-мм-дд, предел = int)

app.get('/api/exercise/log', function (req, res, next) {

  if (!req.query.userId) return next({
    status: 400,
    message: 'unknown userId'
  });

  User.findById(req.query.userId,
                'username',
                {lean: true},
                function (error, user) {

    if (error) {

      if (error.name == 'CastError' &&
          error.kind == 'ObjectId' &&
          error.path == '_id') {
        return next({
          status: 400,
          message: 'unknown userId'
        });
      }

      console.log('Error finding user _id:\n', error);
      return next(error);
    }

    if (!user) return next({
      status: 400,
      message: 'unknown userId'
    });

    const msg = {
      _id: user._id,
      username: user.username
    };

    const filter = {userId: req.query.userId};

    if (req.query.from) {
      const from = new Date(req.query.from);
      if (!isNaN(from.valueOf())) {
        filter.date = {'$gt': from};
        msg.from = from.toDateString();
      }
    }

    if (req.query.to) {
      const to = new Date(req.query.to);
      if (!isNaN(to.valueOf())) {
        if (!filter.date) filter.date = {};
        filter.date['$lt'] = to;
        msg.to = to.toDateString();
      }
    }

    const fields = 'description duration date';
    const options = {sort: {date: -1}};
    const query = Log.find(filter, fields, options).lean();

    if (req.query.limit) {
      const limit = parseInt(req.query.limit);
      if (limit) query.limit(limit);
    }

    query.exec(function(error, posts) {

      //console.log(error);
      if (error) return next(error);

      for (let post of posts) {
        delete post._id;
        post.date = post.date.toDateString();
      }

      msg.count = posts.length;
      msg.log = posts;
      res.json(msg);
    });
  });
});


// Не найдено промежуточное ПО/middleware
app.use((req, res, next) => {
  return next({status: 404, message: 'not found'});
});

// Error Handling middleware/Обработка ошибок промежуточного программного обеспечения
app.use((err, req, res, next) => {
  let errCode, errMessage;

  if (err.errors) {
    // mongoose validation error /ошибка проверки мангуста
    errCode = 400; // bad request
    const keys = Object.keys(err.errors);
    // report the first validation error/сообщить о первой ошибке проверки
    errMessage = err.errors[keys[0]].message;
  } else {
    // generic or custom error/общая или нестандартная ошибка
    errCode = err.status || 500;
    errMessage = err.message || 'Internal Server Error';
  }
  res.status(errCode).type('txt')
    .send(errMessage);
});


const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port);
});
