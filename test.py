from math import floor


def calculateXP(accuracy, shipsSunk, shipsLost, difficulty):
    if difficulty == 0:
        difficultyMultiplier = 2
    elif difficulty == 1:
        difficultyMultiplier = 4
    elif difficulty == 2:
        difficultyMultiplier = 25

    # Calculate base XP
    baseXP = (shipsSunk) / (shipsLost / 2) * 20

    # Calculate accuracy bonus
    accuracyBonus = accuracy * 3  # Adjusted to fit the average target

    # Total XP before applying the difficulty multiplier
    totalXP = (baseXP + accuracyBonus)

    # Apply difficulty multiplier
    totalXP *= difficultyMultiplier

    return floor(totalXP)

print(calculateXP(32, 10, 9, 1))
print(calculateXP(32, 10, 3, 1))
# print(calculateXP(62, 32, 10, 9, 1))

print(calculateXP(52, 10, 6, 1))
print(calculateXP(52, 10, 9, 1))