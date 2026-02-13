# Utilise une image Node légère
FROM node:18-alpine

# Crée le dossier de l'app
WORKDIR /usr/src/app

# Copie les fichiers de dépendances
COPY package*.json ./

# Installe les dépendances
RUN npm install

# Copie le reste du code
COPY . .

# Ouvre le port 3000
EXPOSE 3000

# Lance l'application
CMD ["npm", "start"]