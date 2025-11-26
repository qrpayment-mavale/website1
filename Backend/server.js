const FARE_AMOUNT = 12.00; // Tarifa em MT
const express = require('express');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');

const app = express();
const port = 3000; // porta onde roda o servidor
let db; // Variável para banco de dados

app.use(cors());  // para seguranca entre requisicoes de Origens diferentes
app.use(express.json()); 

//  INICIALIZAÇÃO DA BASE DE DADOS E DO SERVIDOR
// assincrona pk  e uma operacao que leva tempo(levar dados.db.etc) e nao pode bloquerr
//a restante execucao do programa..
async function initializeDatabaseAndServer() {
    try {
        //  cria o arquivo 'payment.sqlite'
        db = await sqlite.open({                 // await pausa ate que o promise seja executdao
            filename: './payment.sqlite',
            driver: sqlite3.Database  
        });

        console.log('Banco de dados SQLite conectado em payment.sqlite');

        // Criação das tabelas tres tabelas user; devices ; Transicao;
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                balance REAL NOT NULL DEFAULT 0.00
            );

            CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'Aguardando',
                timestamp INTEGER NOT NULL,
                user_id_paid TEXT,
                new_balance REAL);

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                amount REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id),
                FOREIGN KEY (device_id) REFERENCES devices(device_id)
            );    
       
        `);
        
        // Inserção dos dados iniciais na tabelas criadas
        await db.run("INSERT OR IGNORE INTO users (user_id, name, balance) VALUES ('1001', 'Nelson', 200.00)");
                await db.run("INSERT OR IGNORE INTO users (user_id, name, balance) VALUES ('5005', 'Claudia', 100.00)");
        await db.run("INSERT OR IGNORE INTO users (user_id, name, balance) VALUES ('2002', 'Andre', 50.00)");
        await db.run("INSERT OR IGNORE INTO users (user_id, name, balance) VALUES ('3003', 'Mavale', 5.00)");
         await db.run("INSERT OR IGNORE INTO users (user_id, name, balance) VALUES ('4004', 'Cumbane', 100.00)");
        await db.run("INSERT OR IGNORE INTO devices (device_id, status, timestamp) VALUES ('MOC001', 'Aguardando', strftime('%s', 'now') * 1000)"); 
        
        //timestamp e o momento em que status actual foi defenido..
  

        console.log('Tabelas e dados iniciais verificados.');

    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
        process.exit(1); // Sai do processo se houver erro crítico no DB nr 1 usado por convecao...
    }

//.........................................................................................   
// ENDPOINT 1: Processar Pagamento :Cobra o valor e atualiza saldo do usuário
// ROTA: POST /api/pay
//.........................................................................................

app.post('/api/pay', async (req, res) => {
    const { userId, deviceId } = req.body;
    const FARE_AMOUNT = 12.00; // Recupere a constante se necessário, ou use a global

    if (!userId || !deviceId) {
        return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    }

    try {
        // Inicia uma transação SQLite 
        await db.exec('BEGIN TRANSACTION');

        let user = await db.get('SELECT * FROM users WHERE user_id = ?', userId); // 1. Obter o usuário

        if (!user) {
            await db.run('UPDATE devices SET status = ?, timestamp = ? WHERE device_id = ?', 
                ['Recusado', Date.now(), deviceId]);
            await db.exec('COMMIT'); // Commit necessário mesmo em falha se houve UPDATE devices
            return res.json({ success: false, message: 'Usuário não encontrado.' });
        }

        // 2. Verificar Saldo
        if (user.balance < FARE_AMOUNT) {
            await db.run('UPDATE devices SET status = ?, timestamp = ? WHERE device_id = ?', 
                ['Recusado', Date.now(), deviceId]);
            await db.exec('COMMIT');
            return res.json({ success: false, message: `Saldo insuficiente. Saldo atual: ${user.balance.toFixed(2)} MT.` });
        }

        // 3. Executar o Débito
        const newBalance = user.balance - FARE_AMOUNT;
        await db.run('UPDATE users SET balance = ? WHERE user_id = ?', [newBalance, userId]);

        // 4. Registrar a Transação 
        await db.run(
            'INSERT INTO transactions (user_id, device_id, amount, timestamp) VALUES (?, ?, ?, ?)',
            [userId, deviceId, FARE_AMOUNT, Date.now()]
        );
        
        // 5. Atualizar o Status do Dispositivo (para o ESP32 consultar)
        await db.run('UPDATE devices SET status = ?, timestamp = ?, user_id_paid = ?, new_balance = ? WHERE device_id = ?',
            ['Sucesso', Date.now(), userId, newBalance, deviceId]);

        // 6. Finalizar a Transação
        await db.exec('COMMIT');

        console.log(`[API] Pagamento de ${FARE_AMOUNT} MT efetuado por ${userId}. Novo saldo: ${newBalance.toFixed(2)} MT.`);
        res.json({ success: true, message: `Pagamento efetuado! Novo saldo: ${newBalance.toFixed(2)} MT.` });
            
    } catch (error) {
        await db.exec('ROLLBACK');
        console.error('[API] Erro na transação:', error);
        res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
    }
});

 // ------------------------------------------------------------------
// ENDPOINT 2: Obter Lista de Usuários e Saldo (Para o Painel Admin)
// ROTA: GET /api/users
// ------------------------------------------------------------------

app.get('/api/users', async (req, res) => {
    try {
        const users = await db.all('SELECT user_id, name, balance FROM users ORDER BY user_id');
        res.json(users);
    } catch (error) {
        console.error('[API] Erro ao obter lista de usuários:', error);
        res.status(500).json({ message: 'Erro interno ao buscar usuários.' });
    }
});

// ------------------------------------------------------------------
// ENDPOINT 4: Obter Valor Acumulado do Dispositivo MOC001
// ROTA: GET /api/revenue/MOC001
// ------------------------------------------------------------------

app.get('/api/revenue/MOC001', async (req, res) => {
    const deviceId = "MOC001"; 

    try {
        console.log(`[API]  CALCULANDO RECEITA PARA ${deviceId}...`);
        
        // 1. Obter todas as transações para debugging
        const allTransactions = await db.all(
            'SELECT id, user_id, amount, timestamp FROM transactions WHERE device_id = ? ORDER BY timestamp DESC',
            deviceId
        );

        // 2. Soma de todos os valores (amount) cobrados por MOC001
        const result = await db.get(
            'SELECT SUM(amount) as totalRevenue FROM transactions WHERE device_id = ?',
            deviceId
        );

        // 3. Conta quantas transações
        const countResult = await db.get(
            'SELECT COUNT(*) as transactionCount FROM transactions WHERE device_id = ?',
            deviceId
        );

        // O resultado pode ser null se não houver transações
        const totalRevenue = result.totalRevenue || 0.00;

        console.log(`[API]  RECEITA ATUALIZADA para ${deviceId}: ${totalRevenue.toFixed(2)} MT`);
    
        res.json({ 
            deviceId, 
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            transactionCount: countResult.transactionCount,
            message: `Receita de ${deviceId}: ${totalRevenue.toFixed(2)} MT (${countResult.transactionCount} transações)`,
            // Adiciona o array de transações para fácil inspeção no painel
            transactions: allTransactions 
        });

    } catch (error) {
        console.error(`[API]  ERRO ao calcular receita para ${deviceId}:`, error);
        res.status(500).json({ message: 'Erro interno ao calcular receita.' });
    }
});

//....................................................................
// ENDPOINT 5: Adicionar Novo Usuário  NOVO
// ROTA: POST /api/users
// ------------------------------------------------------------------
app.post('/api/users', async (req, res) => {
    const { userId, name, initialBalance } = req.body;

    if (!userId || !name || initialBalance === undefined) {
        return res.status(400).json({ success: false, message: 'Dados incompletos para cadastro.' });
    }

    try {
        const balanceValue = parseFloat(initialBalance);
        if (isNaN(balanceValue)) { // isNaN : is Not a Number 
             return res.status(400).json({ success: false, message: 'Saldo inicial deve ser um número válido.' });
        }

        const result = await db.run(
            "INSERT INTO users (user_id, name, balance) VALUES (?, ?, ?)",
            userId, 
            name, 
            balanceValue
        );
        
        console.log(`[API] Usuário ${userId} (${name}) cadastrado com sucesso.`);
        res.json({ success: true, message: `Usuário ${name} cadastrado com sucesso!`, user: { userId, name, balance: balanceValue } });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
             // Se user_id já existir
             return res.status(409).json({ success: false, message: `Erro: O ID de usuário ${userId} já existe.` });
        }
        console.error('[API] Erro ao adicionar usuário:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao cadastrar usuário.' });
    }
});

// ------------------------------------------------------------------
// ENDPOINT 6: Remover Usuário  NOVO
// ROTA: DELETE /api/users/:userId
// ------------------------------------------------------------------
app.delete('/api/users/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await db.run('DELETE FROM users WHERE user_id = ?', userId);

        if (result.changes > 0) {
            console.log(`[API] Usuário ${userId} removido com sucesso.`);
            res.json({ success: true, message: `Usuário ${userId} removido com sucesso.` });
        } else {
            res.status(404).json({ success: false, message: `Usuário com ID ${userId} não encontrado.` });
        }

    } catch (error) {
        console.error('[API] Erro ao remover usuário:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao remover usuário.' });
    }
});

// ------------------------------------------------------------------
// ENDPOINT 2: Obter Status do Dispositivo (Chamado pelo ESP32 - Polling)
// ROTA: GET /api/status/:deviceId
// ------------------------------------------------------------------
/*
    app.get('/api/status/:deviceId', async (req, res) => {
        const { deviceId } = req.params;
        const timeout = 5000; // 5 segundos

        try {
            const device = await db.get('SELECT * FROM devices WHERE device_id = ?', deviceId);

            if (!device) {
                return res.status(404).json({ status: 'Erro', message: 'Dispositivo não registrado.' });
            }

            const currentTime = Date.now();
            
            // Lógica de reset do status após 5 segundos 
            if (device.status !== 'Aguardando' && (currentTime - device.timestamp) > timeout) {
                 // Reseta o status
                 await db.run('UPDATE devices SET status = ?, timestamp = ?, user_id_paid = NULL, new_balance = NULL WHERE device_id = ?',
                    ['Aguardando', currentTime, deviceId]);

                return res.json({ status: 'Aguardando', message: 'Aguardando Passageiro...' });
            }
            
            // Retorna o status atual
            let message = 'Aguardando Passageiro...';
            if (device.status === 'Sucesso') {
                message = `PAGO! Saldo: ${device.new_balance.toFixed(2)} MT`;
            } else if (device.status === 'Recusado') {
                message = `ERRO! PAGAMENTO RECUSADO.`;
            }

            res.json({ status: device.status, message: message });

        } catch (error) {
            console.error('[API] Erro ao obter status:', error);
            res.status(500).json({ status: 'Erro', message: 'Erro no servidor.' });
        }
    });
*/ 
    // Inicia o servidor Express após o DB estar pronto
    app.listen(port, () => {
        console.log(`Backend rodando em http://localhost:${port}`);
    });
}

// Inicializa tudo
initializeDatabaseAndServer();