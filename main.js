const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');

const scoresFilePath = './scores.json';

let client = new WebSocket('wss://hack.chat/chat-ws');

let currentTriviaQuestion = null;
let isAskingQuestion = false;

function send(data) {
    client.send(JSON.stringify(data));
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function formatTriviaQuestionWithChoices(question) {
    const choices = question.incorrect_answers.map((incorrectAnswer) => [incorrectAnswer]);
    choices.push([question.correct_answer]);
    const shuffledChoices = shuffleArray(choices);

    const correctAnswerIndex = shuffledChoices.findIndex((choice) => choice[0] === question.correct_answer);

    const formattedQuestion = `**Category:** ${question.category}\n\n> ${question.question}\n\n**Choices:**\n${shuffledChoices.map((choice, index) => {
        const letterLabel = String.fromCharCode(65 + index);
        return `> ${letterLabel}. ${choice[0]}${index === correctAnswerIndex ? ' ' : ''}`;
    }).join('\n')}`;

    currentTriviaQuestion = {
        ...question,
        correctLetter: String.fromCharCode(65 + correctAnswerIndex)
    };

    return formattedQuestion;
}

const categoryIDs = {
    "general knowledge": 9,
    "books": 10,
    "film": 11,
    "music": 12,
    "musicals and plays": 13,
    "television": 14,
    "video games": 15,
    "board games": 16,
    "science & nature": 17,
    "math": 19,
    "mythology": 20,
    "sports": 21,
    "geography": 22,
    "history": 23,
    "politics": 24,
    "art": 25,
    "celebrities": 26,
    "animals": 27,
    "vehicles": 28,
    "comics": 29,
    "gadgets": 30,
    "anime and manga": 31,
    "cartoon and animations": 32
};

// Load scores from the scores.json file if it exists
let userScores = {};
if (fs.existsSync(scoresFilePath)) {
    try {
        const scoresData = fs.readFileSync(scoresFilePath, 'utf8');
        userScores = JSON.parse(scoresData);
    } catch (error) {
        console.error('Error loading scores from scores.json:', error.message);
    }
}

client.on('open', function () {
    console.log('Client connected');
    send({
        cmd: 'join',
        channel: 'CTL',
        nick: 'TriviaBot'
    });

    send({
        cmd: 'chat',
        text: 'Hello, I am a trivia bot! To see the available categories, type ?categories. To choose a random category, type ?random. To skip a question, type ?skip. To check the scores, type ?scores.'
    });
});

let questionGuesses = {}; // Keep track of user guesses per question
let triviaTimer; // Variable to keep track of the timer
let userHashes = {};

client.on('message', async function (data) {
    let args = JSON.parse(data);

    if (args.cmd == 'onlineSet') {
        for (var i = 0; i < args.users.length; i++) {
            const { nick, hash } = args.users[i];

            userHashes[nick] = hash;
        }
    }
    else if (args.cmd == 'onlineAdd') {
        const { nick, hash } = args;

        userHashes[nick] = hash;
    }
    else if (args.cmd == 'onlineRemove') {
        const { nick, hash } = args;

        delete userHashes[nick];
    }
    else if (args.cmd === 'chat') {
        const { nick, text } = args;
        console.log(`${nick}: ${text}`);

        hash = userHashes[nick];

        if (text.toLowerCase() === '?trivia') {
            if (!isAskingQuestion) {
                send({
                    cmd: 'chat',
                    text: 'To start the trivia game, please choose a category from the following list:\n' +
                        Object.keys(categoryIDs).map((categoryName) => `- ${categoryName}`).join('\n')
                });
            } else {
                send({
                    cmd: 'chat',
                    text: 'Trivia question is already being asked. Please wait for the current question to finish.'
                });
            }
        } else if (text.toLowerCase() === '?categories') {
            send({
                cmd: 'chat',
                text: 'Available trivia categories:\n' +
                    Object.keys(categoryIDs).map((categoryName) => `- ${categoryName}`).join('\n')
            });
        } else if (text.toLowerCase() === '?skip') {
            if (isAskingQuestion && currentTriviaQuestion) {
                isAskingQuestion = false;
                currentTriviaQuestion = null;
                send({
                    cmd: 'chat',
                    text: 'Skipping the current question...'
                });
                clearTimeout(triviaTimer); // Clear the timer if the question is skipped
            } else {
                send({
                    cmd: 'chat',
                    text: 'There is no question to skip at the moment.'
                });
            }
        } else if (text.toLowerCase() === '?scores') {
            // Display scores in descending order from highest to lowest
            const sortedScores = Object.entries(userScores)
                .sort((a, b) => b[1] - a[1])
                .map(([user, score]) => `${user}: ${score} point${score !== 1 ? 's' : ''}`)
                .join('\n');

            if (sortedScores) {
                send({
                    cmd: 'chat',
                    text: 'Current scores:\n' + sortedScores
                });
            } else {
                send({
                    cmd: 'chat',
                    text: 'No scores available yet.'
                });
            }
        } else if (isAskingQuestion && currentTriviaQuestion) {
            const userAnswer = text.trim().toUpperCase();

            if (!questionGuesses[currentTriviaQuestion.question]) {
                questionGuesses[currentTriviaQuestion.question] = {}; // Initialize guesses for the current question if not present.
            }

            if (!questionGuesses[currentTriviaQuestion.question][hash] && userAnswer.length === 1 && userAnswer >= 'A' && userAnswer <= String.fromCharCode(65 + currentTriviaQuestion.incorrect_answers.length)) {
                console.log(`${hash} guessed: ${userAnswer}`);
                questionGuesses[currentTriviaQuestion.question][hash] = true;

                if (userAnswer === currentTriviaQuestion.correctLetter.trim().toUpperCase()) {
                    // Increment the user's score
                    userScores[nick] = (userScores[nick] || 0) + 1;
                    saveScoresToFile();
                    send({
                        cmd: 'chat',
                        text: `Correct, ${nick}! ${userScores[nick]} point${userScores[nick] !== 1 ? 's' : ''} total. Well done! 🎉`
                    });

                    isAskingQuestion = false;
                    currentTriviaQuestion = null;
                    clearTimeout(triviaTimer); // Clear the timer when a correct answer is received
                }
            }
        } else {
            let chosenCategory = text.toLowerCase();

            if (chosenCategory === '?random') {
                const categoryNames = Object.keys(categoryIDs);
    
                const randomIndex = Math.floor(Math.random() * categoryNames.length);
    
                chosenCategory = categoryNames[randomIndex];
            }

            if (categoryIDs[chosenCategory]) {
                try {
                    const triviaQuestion = await fetchTriviaQuestion(categoryIDs[chosenCategory]);
                    if (triviaQuestion) {
                        currentTriviaQuestion = triviaQuestion;
                        questionGuesses[currentTriviaQuestion.question] = {}; // Initialize guesses for the new question.
                        sendNextTriviaQuestion();
                        triviaTimer = setTimeout(() => {
                            if (currentTriviaQuestion === null)
                                return; // Race condition
                            send({
                                cmd: 'chat',
                                text: `Time's up! The correct answer was ${currentTriviaQuestion.correct_answer}. Moving on to the next question...`
                            });
                            isAskingQuestion = false;
                            currentTriviaQuestion = null;
                        }, 30000); // 30 seconds timer
                    } else {
                        send({
                            cmd: 'chat',
                            text: 'Sorry, there was an issue fetching a trivia question. Please try again later.'
                        });
                    }
                } catch (error) {
                    console.error('Error fetching trivia question:', error.message);
                    send({
                        cmd: 'chat',
                        text: 'Sorry, there was an issue fetching a trivia question. Please try again later.'
                    });
                }
            }
        }
    }
});

async function fetchTriviaQuestion(categoryID) {
    try {
        const response = await axios.get(`https://opentdb.com/api.php?amount=1&category=${categoryID}&type=multiple`);
        if (response.data.results && response.data.results.length > 0) {
            return response.data.results[0];
        }
        return null;
    } catch (error) {
        throw new Error('Error fetching a trivia question.');
    }
}

function sendNextTriviaQuestion() {
    isAskingQuestion = true;
    const formattedQuestion = formatTriviaQuestionWithChoices(currentTriviaQuestion);
    send({
        cmd: 'chat',
        text: formattedQuestion
    });
}

// Function to save the userScores object to scores.json
function saveScoresToFile() {
    try {
        const sortedScores = Object.entries(userScores)
            .sort((a, b) => b[1] - a[1])
            .map(([user, score]) => `${user}: ${score} point${score !== 1 ? 's' : ''}`)
            .join('\n');
        const scoresData = JSON.stringify(userScores, null, 2);
        fs.writeFileSync(scoresFilePath, scoresData, 'utf8');
    } catch (error) {
        console.error('Error saving scores to scores.json:', error.message);
    }
}
